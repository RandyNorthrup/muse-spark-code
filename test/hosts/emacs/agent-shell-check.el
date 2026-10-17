;;; agent-shell-check.el --- The ACP agent in agent-shell, in batch  -*- lexical-binding: t -*-
;; Host check (hosts.yml, PLAN.md M63): the agent-shell configuration of
;; docs/acp.md starts muse-spark-code-acp on the fake Muse Code CLI; a reply,
;; a command allowed with `y' and one rejected with `C-c C-c' (which cancels
;; the turn, so the permission is answered `cancelled'). Environment:
;; ACP_EL_DIR, MUSE_ACP, FAKE_MUSE, WORKSPACE. Exits 1 on a miss.
(add-to-list 'load-path (getenv "ACP_EL_DIR"))
(require 'agent-shell)

(defvar muse-failures 0)

(defun muse-pump (seconds &optional predicate)
  (let ((deadline (+ (float-time) seconds)))
    (while (and (< (float-time) deadline) (not (and predicate (funcall predicate))))
      (accept-process-output nil 0.05))))

(defun muse-config ()
  (agent-shell-make-agent-config
   :identifier 'muse-spark
   :mode-line-name "Muse Spark"
   :buffer-name "Muse Spark"
   :shell-prompt "Muse> "
   :shell-prompt-regexp "Muse> "
   :client-maker (lambda (buffer)
                   (acp-make-client :command (getenv "MUSE_ACP")
                                    :command-params (list "--muse-binary" (getenv "FAKE_MUSE"))
                                    :context-buffer buffer))))

(let ((default-directory (file-name-as-directory (getenv "WORKSPACE"))))
  (agent-shell-start :config (muse-config))
  (let* ((shell (seq-find (lambda (b) (with-current-buffer b (derived-mode-p 'agent-shell-mode))) (buffer-list)))
         (text (lambda () (with-current-buffer shell (buffer-substring-no-properties (point-min) (point-max)))))
         (seen (lambda (pattern) (string-match-p pattern (funcall text))))
         (expect (lambda (label pattern)
                   (muse-pump 20 (lambda () (funcall seen pattern)))
                   (let ((ok (funcall seen pattern)))
                     (princ (format "%s %s\n" (if ok "ok  " "FAIL") label))
                     (unless ok (setq muse-failures (1+ muse-failures)))))))
    (unless shell (princ "FAIL no agent-shell buffer\n") (kill-emacs 1))
    (funcall expect "the agent is ready" "Ready")
    (agent-shell-insert :text "hello from agent-shell" :submit t :shell-buffer shell)
    (funcall expect "a reply streams" "echo: hello from agent-shell")
    (agent-shell-insert :text "tool: echo allowed-in-agent-shell" :submit t :shell-buffer shell)
    (funcall expect "the permission prompt shows" "Allow once")
    (with-current-buffer shell
      (goto-char (point-max))
      (search-backward "Allow once")
      (call-interactively (key-binding (kbd "y"))))
    (funcall expect "`y' allows the command once" "ran: echo allowed-in-agent-shell")
    (agent-shell-insert :text "tool: echo rejected-in-agent-shell" :submit t :shell-buffer shell)
    (muse-pump 20 (lambda () (string-match-p "rejected-in-agent-shell\\(.\\|\n\\)*Allow once" (funcall text))))
    (with-current-buffer shell
      (goto-char (point-max))
      (search-backward "Reject")
      (call-interactively (key-binding (kbd "C-c C-c"))))
    (funcall expect "`C-c C-c' rejects it" "skipped: echo rejected-in-agent-shell")
    (when (> muse-failures 0)
      (princ (format "--- the shell buffer ---\n%s\n" (funcall text))))))
(kill-emacs (if (zerop muse-failures) 0 1))
