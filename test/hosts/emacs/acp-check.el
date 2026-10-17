;;; acp-check.el --- The ACP agent through acp.el, in batch  -*- lexical-binding: t -*-
;; Host check (hosts.yml, PLAN.md M63): acp.el, the protocol library
;; agent-shell is built on, drives muse-spark-code-acp on the fake Muse Code
;; CLI: initialize, a session, a reply, a command allowed, the session list.
;; Environment: ACP_EL_DIR, MUSE_ACP, FAKE_MUSE, WORKSPACE. Exits 1 on a miss.
(add-to-list 'load-path (getenv "ACP_EL_DIR"))
(require 'acp)
(require 'map)

(defvar muse-updates nil)
(defvar muse-permissions nil)
(defvar muse-failures 0)

(defun muse-wait (predicate seconds)
  (let ((deadline (+ (float-time) seconds)))
    (while (and (not (funcall predicate)) (< (float-time) deadline))
      (accept-process-output nil 0.05))
    (funcall predicate)))

(defun muse-expect (label ok)
  (princ (format "%s %s\n" (if ok "ok  " "FAIL") label))
  (unless ok (setq muse-failures (1+ muse-failures))))

(defun muse-text (kind)
  "The streamed text of every KIND update, joined."
  (mapconcat (lambda (update)
               (let ((content (and (equal (map-elt update 'sessionUpdate) kind)
                                   (map-elt update 'content))))
                 (if (equal (map-elt content 'type) "text") (map-elt content 'text) "")))
             (reverse muse-updates) ""))

(let* ((client (acp-make-client :command (getenv "MUSE_ACP")
                                :command-params (list "--muse-binary" (getenv "FAKE_MUSE"))))
       (cwd (getenv "WORKSPACE"))
       (init nil) (session nil) (first-stop nil) (second-stop nil) (listed nil) (failure nil))
  (acp-subscribe-to-notifications
   :client client
   :on-notification (lambda (n) (let-alist n (when (equal .method "session/update") (push .params.update muse-updates)))))
  (acp-subscribe-to-requests
   :client client
   :on-request (lambda (r)
                 (let-alist r
                   (when (equal .method "session/request_permission")
                     (push .params muse-permissions)
                     (let ((allow (seq-find (lambda (o) (equal (map-elt o 'kind) "allow_once")) .params.options)))
                       (acp-send-response
                        :client client
                        :response (acp-make-session-request-permission-response
                                   :request-id .id :option-id (map-elt allow 'optionId))))))))
  (acp-send-request :client client
                    :request (acp-make-initialize-request :protocol-version 1)
                    :on-success (lambda (r) (setq init r))
                    :on-failure (lambda (e) (setq failure e)))
  (muse-wait (lambda () (or init failure)) 30)
  (muse-expect "initialize names the agent"
               (equal (map-nested-elt init '(agentInfo name)) "muse-spark-code-acp"))
  (acp-send-request :client client
                    :request (acp-make-session-new-request :cwd cwd)
                    :on-success (lambda (r) (setq session r))
                    :on-failure (lambda (e) (setq failure e)))
  (muse-wait (lambda () (or session failure)) 30)
  (let ((sid (map-elt session 'sessionId)))
    (muse-expect "session/new offers the four modes"
                 (= 4 (length (map-nested-elt session '(modes availableModes)))))
    (acp-send-request :client client
                      :request (acp-make-session-prompt-request
                                :session-id sid :prompt '(((type . "text") (text . "hello from emacs"))))
                      :on-success (lambda (r) (setq first-stop (map-elt r 'stopReason)))
                      :on-failure (lambda (e) (setq failure e)))
    (muse-wait (lambda () (or first-stop failure)) 30)
    (muse-expect "a reply streams and the turn ends"
                 (and (equal first-stop "end_turn")
                      (equal (muse-text "agent_message_chunk") "echo: hello from emacs")))
    (setq muse-updates nil)
    (acp-send-request :client client
                      :request (acp-make-session-prompt-request
                                :session-id sid :prompt '(((type . "text") (text . "tool: echo from-emacs"))))
                      :on-success (lambda (r) (setq second-stop (map-elt r 'stopReason)))
                      :on-failure (lambda (e) (setq failure e)))
    (muse-wait (lambda () (or second-stop failure)) 30)
    (muse-expect "a command asks, is allowed once and runs"
                 (and (equal second-stop "end_turn")
                      (= 1 (length muse-permissions))
                      (string-match-p "ran: echo from-emacs" (muse-text "agent_message_chunk"))))
    (acp-send-request :client client
                      :request (acp-make-session-list-request :cwd cwd)
                      :on-success (lambda (r) (setq listed r))
                      :on-failure (lambda (e) (setq failure e)))
    (muse-wait (lambda () (or listed failure)) 30)
    (muse-expect "session/list holds the session"
                 (member sid (mapcar (lambda (s) (map-elt s 'sessionId)) (map-elt listed 'sessions)))))
  (when failure (muse-expect (format "no request failed (%S)" failure) nil))
  (acp-shutdown :client client)
  (kill-emacs (if (zerop muse-failures) 0 1)))
