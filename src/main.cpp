#include "httplib.h"
#include "json.hpp"
#include <chrono>
#include <fstream>
#include <iostream>
#include <signal.h>
#include <sstream>
#include <string>
#include <sys/wait.h>
#include <thread>
#include <unistd.h>
#include <vector>

using json = nlohmann::json;

struct RunResult {
  std::string output;
  int         exit_code = -1;
  bool        timed_out = false;
};

struct TempFiles {
  std::string in, out;
  ~TempFiles() {
    if (!in.empty())
      unlink(in.c_str());
    if (!out.empty())
      unlink(out.c_str());
  }
};

RunResult
compile_code(const std::string& code) {
  RunResult result;

  char in_tpl[]  = "/tmp/agc_in_XXXXXX.ag";
  char out_tpl[] = "/tmp/agc_out_XXXXXX";
  int  in_fd     = mkstemps(in_tpl, 3);
  int  out_fd    = mkstemp(out_tpl);
  if (in_fd < 0 || out_fd < 0) {
    if (in_fd >= 0) {
      close(in_fd);
      unlink(in_tpl);
    }
    if (out_fd >= 0) {
      close(out_fd);
      unlink(out_tpl);
    }
    result.exit_code = 1;
    return result;
  }
  close(in_fd);
  close(out_fd);

  TempFiles          tmp{in_tpl, out_tpl};
  const std::string& input_file  = tmp.in;
  const std::string& output_file = tmp.out;

  {
    std::ofstream in_file(input_file);
    if (!in_file.is_open()) {
      result.exit_code = 1;
      return result;
    }
    in_file << code;
  }

  std::vector<const char*> args = {"agc", input_file.c_str(), "-o", "json", output_file.c_str(), nullptr};

  pid_t pid = fork();
  if (pid < 0) {
    result.exit_code = 1;
    return result;
  }
  if (pid == 0) {
    execv("/usr/local/bin/agc", (char* const*)args.data());
    _exit(127);
  }

  int  status   = 0;
  auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
  while (true) {
    pid_t w = waitpid(pid, &status, WNOHANG);
    if (w == pid)
      break;
    if (w < 0) {
      result.exit_code = 1;
      return result;
    }
    if (std::chrono::steady_clock::now() > deadline) {
      kill(pid, SIGKILL);
      waitpid(pid, &status, 0);
      result.timed_out = true;
      return result;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  result.exit_code = WIFEXITED(status) ? WEXITSTATUS(status) : 1; // 1 if killed by a signal (crash)

  std::ifstream out_file(output_file);
  if (out_file.is_open()) {
    std::stringstream ss;
    ss << out_file.rdbuf();
    result.output = ss.str();
  }
  return result;
}

static void
send_error(httplib::Response& res,
           int                status,
           const std::string& msg) {
  res.status = status;
  res.set_content(json{{"status", false}, {"error", msg}, {"output", ""}}.dump(), "application/json");
}

int
main() {
  httplib::Server server;
  server.set_payload_max_length(1024 * 1024 * 10);
  if (!server.set_mount_point("/", "./web_view")) {
    std::cerr << "Web Root not found!" << std::endl;
  }

  server.Options("/compile", [](const httplib::Request& req, httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
    res.set_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set_header("Access-Control-Allow-Headers", "Content-Type");
  });

  server.Get("/health", [](const httplib::Request& req, httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
    res.set_content(json{{"status", "ok"}, {"service", "agc-server"}, {"version", "1.0.0"}}.dump(), "application/json");
  });

  server.Post("/compile", [](const httplib::Request& req, httplib::Response& res) {
    res.set_header("Access-Control-Allow-Origin", "*");
    json body = json::parse(req.body, nullptr, false);
    if (body.is_discarded() || !body.is_object() || !body.contains("code") || !body["code"].is_string()) {
      send_error(res, 400, "request must be JSON with a string field \"code\"");
      return;
    }

    RunResult result = compile_code(body["code"].get<std::string>());

    if (result.timed_out) {
      send_error(res, 504, "compiler timed out");
      return;
    }
    if (result.exit_code == 127) {
      send_error(res, 500, "could not run /usr/local/bin/agc");
      return;
    }

    json data = json::parse(result.output, nullptr, false);

    if (result.exit_code == 0) {
      if (data.is_discarded()) {
        send_error(res, 500, "compiler produced invalid JSON");
        return;
      }
      res.status = 200;
      res.set_content(data.dump(), "application/json");
      return;
    }

    // Non-zero exit: the user's code had an error (or the compiler failed).
    if (!data.is_discarded()) { // agc wrote error JSON into the output file
      res.status = 422;
      res.set_content(data.dump(), "application/json");
    } else {
      send_error(res, 422, result.output.empty() ? "compilation failed" : result.output);
    }
  });

  if (!server.listen("localhost", 8080)) {
    std::cerr << "Failed to Bind Port!" << std::endl;
    return 1;
  }
  return 0;
}
