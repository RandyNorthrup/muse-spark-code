;;; muse-spark.el --- Muse Spark Code (Unofficial) companion -*- lexical-binding: t; -*-

;; Copyright (C) 2026 Randy Northrup
;; SPDX-License-Identifier: MIT
;; Version: 0.1.0
;; Package-Requires: ((emacs "29.1") (agent-shell "0.77.4"))
;; Keywords: tools
;; URL: https://github.com/RandyNorthrup/muse-spark-code
;; Assisted-by: Codex:GPT-6

;;; Commentary:

;; `muse-spark-start' opens the agent-shell ACP route.  `muse-spark-panel'
;; starts the companion, or opens a fresh /panel launch URL in an xwidget
;; where built, otherwise in a browser.  Auth and paid consent stay in the
;; runtime and shared panel.  No credential is read from the OS store here.

;;; Code:

(require 'cl-lib)
(require 'browse-url)
(require 'url-parse)
(require 'project)
(declare-function agent-shell-start "agent-shell")
(declare-function agent-shell-make-agent-config "agent-shell")
(declare-function agent-shell-interrupt "agent-shell")
(declare-function acp-make-client "acp")
(declare-function eglot "eglot")
(defvar eglot-server-programs)
(declare-function xwidget-webkit-browse-url "xwidget")

(defgroup muse-spark nil
  "Muse Spark Code (Unofficial)."
  :group 'tools)

(defcustom muse-spark-command '("muse-spark-code-acp")
  "Argv for the installed agent; no shell expansion or credential arguments."
  :type '(repeat string))

(defcustom muse-spark-lsp-arguments nil
  "Extra LSP argv; paid Tab needs --tab and --trust-workspace."
  :type '(repeat string))

(defun muse-spark--argv (verb &optional supervised)
  "Insert VERB after the executable/script prefix; optionally SUPERVISED."
  (let* ((tail (cdr muse-spark-command))
         (script (and tail (not (string-prefix-p "-" (car tail)))))
         (prefix (if script (cl-subseq muse-spark-command 0 2)
                   (list (car muse-spark-command)))))
    (append prefix (when supervised '("supervise")) (when verb (list verb))
            (if script (cdr tail) tail))))

(defun muse-spark--workspace ()
  "Return the current project root, or the current directory."
  (let ((project (project-current nil)))
    (if project (project-root project) default-directory)))

;;;###autoload
(defun muse-spark-lsp ()
  "Start Eglot's completion, diagnostics and code-action route for this project."
  (interactive)
  (require 'eglot)
  (let ((process-environment (muse-spark--environment))
        (default-directory (muse-spark--workspace))
        (eglot-server-programs
         (cons (cons major-mode (append (muse-spark--argv "lsp")
                                        muse-spark-lsp-arguments))
               eglot-server-programs)))
    (call-interactively #'eglot)))

(defvar muse-spark--process nil "This editor's companion process.")
(defvar-local muse-spark--owned-shell nil "Whether this buffer uses Muse's ACP route.")

(defun muse-spark--environment ()
  "Return `process-environment' with credential variables removed."
  (cl-remove-if
   (lambda (entry)
     (let ((name (upcase (car (split-string entry "=")))))
       (or (string-suffix-p "_API_KEY" name)
           (member name '("AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY"
                          "AWS_SESSION_TOKEN" "OPENAI_KEY"
                          "ANTHROPIC_KEY" "META_KEY")))))
   process-environment))

(defun muse-spark--valid-url-p (url)
  "Whether URL is an IP-literal loopback fragment launch URL."
  (and (stringp url)
       (string-match
        "\\`http://\\(?:127\\.0\\.0\\.1\\|\\[::1\\]\\):\\([0-9]+\\)/#k=\\([A-Za-z0-9_-]+\\)\\'"
        url)
       (> (string-to-number (match-string 1 url)) 0)
       (<= (string-to-number (match-string 1 url)) 65535)))

;;;###autoload
(defun muse-spark-panel (&optional url)
  "Open a companion for the current workspace.
With fresh URL from the ACP /panel route, prefer an xwidget, else browser.
Without URL, let the installed panel runtime open its own browser."
  (interactive)
  (let ((process-environment (muse-spark--environment))
        (default-directory (muse-spark--workspace)))
    (if url
        (progn
          (unless (muse-spark--valid-url-p url)
            (error "EPANEL_LAUNCH_URL"))
          (if (and (featurep 'xwidget-internal)
                   (fboundp 'xwidget-webkit-browse-url))
              (xwidget-webkit-browse-url url)
            (browse-url url)))
      (when (process-live-p muse-spark--process)
        (error "EPANEL_ALREADY_RUNNING"))
      (let ((stderr (make-pipe-process :name "muse-spark-stderr"
                                       :buffer nil :filter #'ignore :noquery t)))
        (condition-case nil
            (setq muse-spark--process
                  (make-process
             :name "muse-spark-companion"
             :command (append (muse-spark--argv "panel" t) '("--companion"))
             :connection-type 'pipe :noquery t
             ;; Discard launch codes and raw provider output, including stderr.
             :buffer nil :filter #'ignore
             :stderr stderr
             :sentinel (lambda (child _event)
                         (unless (process-live-p child)
                           (let ((stderr (process-get child 'muse-stderr)))
                             (when (processp stderr) (delete-process stderr)))
                           (when (eq child muse-spark--process)
                             (setq muse-spark--process nil)
                             (when (and (eq (process-status child) 'exit)
                                        (/= (process-exit-status child) 0))
                               (message "EPANEL_EXIT")))))))
          (error
           (delete-process stderr)
           (error "EPANEL_LAUNCH")))
        (process-put muse-spark--process 'muse-stderr stderr)))))

;;;###autoload
(defun muse-spark-start ()
  "Start Muse Spark Code (Unofficial) through agent-shell's ACP route."
  (interactive)
  (require 'agent-shell)
  (let ((process-environment (muse-spark--environment)))
    (agent-shell-start
     :config
     (agent-shell-make-agent-config
      :identifier 'muse-spark
      :mode-line-name "Muse Spark Code (Unofficial)"
      :buffer-name "Muse Spark Code (Unofficial)"
      :shell-prompt "Muse> " :shell-prompt-regexp "Muse> "
      :client-maker
      (lambda (buffer)
        (with-current-buffer buffer
          (setq muse-spark--owned-shell t))
        ;; The client can be recreated after the dynamic binding has ended.
        (let ((process-environment (muse-spark--environment)))
          (acp-make-client :command (car muse-spark-command)
                           :command-params (cdr (muse-spark--argv nil t))
                           :context-buffer buffer)))))))

;;;###autoload
(defun muse-spark-stop ()
  "Cancel the active agent-shell turn and terminate this companion."
  (interactive)
  (let ((process-environment (muse-spark--environment))
        (default-directory (muse-spark--workspace)) failed)
    (condition-case nil
        (let ((stderr (make-pipe-process :name "muse-stop-stderr"
                                        :buffer nil :filter #'ignore :noquery t)))
          (condition-case nil
              (let ((child (make-process :name "muse-stop" :command (muse-spark--argv "stop")
                     :connection-type 'pipe :noquery t :buffer nil :filter #'ignore
                     :stderr stderr :sentinel
                     (lambda (child _event)
                       (unless (process-live-p child)
                         (let ((pipe (process-get child 'muse-stderr)))
                           (when (processp pipe) (delete-process pipe)))
                         (when (/= (process-exit-status child) 0)
                           (message "EPANEL_STOP")))))))
            (process-put child 'muse-stderr stderr))
            (error (delete-process stderr) (setq failed t))))
      (error (setq failed t)))
    (condition-case nil
        (when (and muse-spark--owned-shell (derived-mode-p 'agent-shell-mode))
          (agent-shell-interrupt))
      (error (setq failed t)))
    (condition-case nil
        (progn
          (when (process-live-p muse-spark--process)
            (delete-process muse-spark--process))
          (setq muse-spark--process nil))
      (error (setq failed t)))
    (when failed (message "EPANEL_STOP"))))

(add-hook 'kill-emacs-hook #'muse-spark-stop)
(provide 'muse-spark)
;;; muse-spark.el ends here
