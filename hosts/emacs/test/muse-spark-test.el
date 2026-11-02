;;; muse-spark-test.el --- Real-agent shim tests -*- lexical-binding: t; -*-
;; Every child below is this tree's real dist/acp.js, started through the
;; host's own argv and environment functions.  Run `npm run build` first.
(require 'ert)
(require 'json)
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

(defconst muse-test--wait-seconds 30
  "Bound for one real agent reply; a hung child fails instead of hanging.")

(defconst muse-test--root
  (expand-file-name "../../.." (file-name-directory (or load-file-name buffer-file-name)))
  "This repository's root, from this file's own location, taken at load.")

(defun muse-test--agent-command ()
  "The real agent argv: this machine's node over this tree's dist/acp.js."
  (let ((node (executable-find "node"))
        (agent (expand-file-name "dist/acp.js" muse-test--root)))
    (unless node (ert-fail "node is required"))
    (unless (file-exists-p agent)
      (ert-fail "dist/acp.js missing: run npm run build first"))
    (list node agent)))

(defun muse-test--scratch ()
  "A fresh home and workspace under the system temporary directory."
  (let ((home (make-temp-file "muse-emacs-home" t))
        (workspace (make-temp-file "muse-emacs-workspace" t)))
    (list home workspace)))

(defun muse-test--environment (home)
  "The editor environment for a scratch run, sentinel credential included."
  (append (list (concat "HOME=" home)
                (concat "XDG_DATA_HOME=" (expand-file-name "data" home))
                (concat "XDG_CONFIG_HOME=" (expand-file-name "config" home))
                "M104_API_KEY=test-sentinel")
          (cl-remove-if (lambda (entry)
                          (string-match-p "\\`\\(?:HOME\\|XDG_DATA_HOME\\|XDG_CONFIG_HOME\\|META_API_KEY\\)=" entry))
                        process-environment)))

(defun muse-test--wait-for (process predicate)
  "Drive PROCESS in real time until PREDICATE holds or the bound passes."
  (let ((deadline (+ (float-time) muse-test--wait-seconds)))
    (while (and (not (funcall predicate)) (< (float-time) deadline))
      (accept-process-output process 0.1)))
  (funcall predicate))

(defun muse-test--environ (process)
  "The child's live environment names, read from its /proc entry."
  (with-temp-buffer
    (insert-file-contents (format "/proc/%d/environ" (process-id process)))
    (split-string (buffer-string) "\0" t)))

(ert-deftest muse-lsp-real-agent-lifecycle ()
  "The host's lsp argv starts the real server; it answers and exits 0."
  (pcase-let ((`(,home ,workspace) (muse-test--scratch)))
    (unwind-protect
        (let* ((muse-spark-command (muse-test--agent-command))
               ;; As muse-spark-lsp binds it for eglot: scrubbed at launch.
               (process-environment (let ((process-environment
                                           (muse-test--environment home)))
                                      (muse-spark--environment)))
               (default-directory workspace)
               (received "")
               (child (make-process
                       :name "muse-test-lsp"
                       :command (append (muse-spark--argv "lsp")
                                        (list "--workspace" workspace))
                       :connection-type 'pipe :noquery t
                       :filter (lambda (_process chunk)
                                 (setq received (concat received chunk))))))
          (unwind-protect
              (progn
                ;; No credential reaches the real child (Linux /proc).
                (when (eq system-type 'gnu/linux)
                  (dolist (entry (muse-test--environ child))
                    (should-not (string-prefix-p "M104_API_KEY=" entry))))
                (let* ((body (json-serialize
                              `((jsonrpc . "2.0") (id . 1) (method . "initialize")
                                (params . ((processId . ,(emacs-pid))
                                           (rootUri . ,(concat "file://" workspace))
                                           (capabilities . ,(make-hash-table))
                                           (workspaceFolders
                                            . [((uri . ,(concat "file://" workspace))
                                                (name . "workspace"))])))))))
                  (process-send-string
                   child (format "Content-Length: %d\r\n\r\n%s" (string-bytes body) body)))
                (should (muse-test--wait-for
                         child (lambda ()
                                 (string-match-p "\"id\":1" received))))
                (should (string-match-p "\"muse\\.stop\"" received))
                (let* ((body (json-serialize
                              '((jsonrpc . "2.0") (id . 2) (method . "shutdown")
                                (params . :null)))))
                  (process-send-string
                   child (format "Content-Length: %d\r\n\r\n%s" (string-bytes body) body)))
                (should (muse-test--wait-for
                         child (lambda ()
                                 (string-match-p "\"id\":2" received))))
                (let* ((body (json-serialize
                              '((jsonrpc . "2.0") (method . "exit")))))
                  (process-send-string
                   child (format "Content-Length: %d\r\n\r\n%s" (string-bytes body) body)))
                (should (muse-test--wait-for
                         child (lambda () (not (process-live-p child)))))
                (should (= (process-exit-status child) 0)))
            (when (process-live-p child) (delete-process child))))
      (delete-directory home t)
      (delete-directory workspace t))))

(ert-deftest muse-panel-real-agent-refusal-cleans-up ()
  "The companion launch meets the real agent and its refusal is surfaced.
The runtime's one panel transport is --stdio on this contract, so the
supervised --companion child exits; the shim must clear its ownership."
  (pcase-let ((`(,home ,workspace) (muse-test--scratch)))
    (unwind-protect
        (let ((muse-spark-command (muse-test--agent-command))
              (muse-spark--process nil)
              (process-environment (muse-test--environment home))
              (default-directory workspace))
          (muse-spark-panel)
          (let ((child muse-spark--process))
            (should (processp child))
            (should (muse-test--wait-for
                     child (lambda () (not muse-spark--process))))
            (should-not (= (process-exit-status child) 0))
            (should-not (process-live-p (get-process "muse-spark-stderr")))
            (muse-spark-stop)
            (should-not muse-spark--process)))
      (delete-directory home t)
      (delete-directory workspace t))))

(defun muse-test--supervision-possible-p ()
  "Whether supervise's owner-only root can hold on this machine.
Its ancestor rule admits only root or the caller above the root; a
sandbox whose / is neither (uid 65534 on this rig) refuses every run."
  (let ((owner (file-attribute-user-id (file-attributes "/" 'integer))))
    (or (= owner 0) (= owner (user-uid)))))

(ert-deftest muse-acp-real-agent-handshake ()
  "The host's supervised ACP argv starts the real agent and it answers."
  (skip-unless (muse-test--supervision-possible-p))
  (pcase-let ((`(,home ,workspace) (muse-test--scratch)))
    (unwind-protect
        (let* ((muse-spark-command (muse-test--agent-command))
               (process-environment (muse-test--environment home))
               (default-directory workspace)
               (lines nil)
               (child (make-process
                       :name "muse-test-acp"
                       :command (muse-spark--argv nil t)
                       :connection-type 'pipe :noquery t
                       :filter (lambda (_process chunk)
                                 (setq lines (append lines (split-string chunk "\n" t)))))))
          (unwind-protect
              (progn
                (process-send-string
                 child
                 (concat (json-serialize
                          '((jsonrpc . "2.0") (id . 0) (method . "initialize")
                            (params . ((protocolVersion . 1)
                                       (clientCapabilities . ((fs . ((readTextFile . t)))))
                                       (clientInfo . ((name . "muse-emacs-test")
                                                      (version . "0")))))))
                         "\n"))
                (should (muse-test--wait-for child (lambda () lines)))
                (let ((reply (json-parse-string (car lines) :object-type 'alist)))
                  (should (= (alist-get 'protocolVersion (alist-get 'result reply)) 1))
                  (should (equal (alist-get 'name (alist-get 'agentInfo (alist-get 'result reply)))
                                 "muse-spark-code-acp")))
                (process-send-string
                 child
                 (concat (json-serialize
                          `((jsonrpc . "2.0") (id . 1) (method . "session/new")
                            (params . ((cwd . ,workspace) (mcpServers . [])))))
                         "\n"))
                (should (muse-test--wait-for
                         child (lambda () (>= (length lines) 2))))
                ;; No sign-in in the scratch home: said refusal, no model call.
                (let ((reply (json-parse-string (nth 1 lines) :object-type 'alist)))
                  (should (equal (alist-get 'kind (alist-get 'data (alist-get 'error reply)))
                                 "authRequired")))
                (process-send-eof child)
                (should (muse-test--wait-for
                         child (lambda () (not (process-live-p child))))))
            (when (process-live-p child) (delete-process child))))
      (delete-directory home t)
      (delete-directory workspace t))))
