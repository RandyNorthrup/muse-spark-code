;;; muse-spark-test.el --- Offline shim tests -*- lexical-binding: t; -*-
(require 'ert)
(require 'muse-spark)

(ert-deftest muse-fragment-launch-only ()
  (should (muse-spark--valid-url-p "http://127.0.0.1:41234/#k=test-launch"))
  (should (muse-spark--valid-url-p "http://[::1]:41234/#k=test-launch"))
  (dolist (url '("https://127.0.0.1:41234/#k=test-launch"
                 "http://localhost:41234/#k=test-launch"
                 "http://127.0.0.1.evil:41234/#k=test-launch"
                 "http://127.0.0.1:0/#k=test-launch"
                 "http://127.0.0.1:65536/#k=test-launch"
                 "http://127.0.0.1:41234/?k=test-launch"
                 "http://127.0.0.1:41234/#k=test-launch&token=value"
                 "http://127.0.0.1:41234/#k=test-launch\n"))
    (should-not (muse-spark--valid-url-p url))))

(ert-deftest muse-environment-removes-credentials ()
  (let ((process-environment '("PATH=/bin" "M104_API_KEY=test-sentinel"
                                "m104_api_key=test-sentinel" "OPENAI_KEY=test-sentinel"
                                "AWS_SESSION_TOKEN=test-sentinel")))
    (should (equal (muse-spark--environment) '("PATH=/bin")))
    (should (= (length process-environment) 5))))

(ert-deftest muse-real-child-cleanup-and-duplicate-refusal ()
  (let ((muse-spark-command '("/bin/cat"))
        (muse-spark--process nil)
        (process-environment (cons "M104_API_KEY=test-sentinel" process-environment)))
    ;; cat rejects panel flags and exits; a real process exercises the sentinel.
    (muse-spark-panel)
    (let ((child muse-spark--process))
      (should (processp child))
      (should-error (muse-spark-panel))
      (muse-spark-stop)
      (should-not (process-live-p child))
      (accept-process-output nil 0.05)
      (should-not muse-spark--process)
      (should-not (process-live-p (get-process "muse-spark-stderr"))))))
