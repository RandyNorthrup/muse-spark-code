;;; Manual installed-host qualification probe; a missing bootstrap must fail.
(require 'muse-spark)
(let ((receipt-path (expand-file-name "temp/emacs-bootstrap.json")))
  (make-directory (file-name-directory receipt-path) t)
  (when (file-exists-p receipt-path) (delete-file receipt-path))
  (setq muse-spark-command
        (list "python3" (expand-file-name "test/m104/linux/shims/handshake.py") receipt-path))
  (unwind-protect
      (progn
        (muse-spark-panel)
        (let ((deadline (+ (float-time) 4)))
          (while (and (< (float-time) deadline) (not (file-exists-p receipt-path)))
            (accept-process-output nil 0.05)))
        (let ((receipt (json-parse-string
                        (with-temp-buffer
                          (insert-file-contents receipt-path)
                          (buffer-string))
                        :object-type 'alist)))
          (unless (eq (alist-get 'credential_variable_present receipt) :false)
            (error "Credential variable reached fake peer"))
          (when (eq (alist-get 'initialized receipt) :false)
            (error "MHP_13_BOOTSTRAP_MISSING"))))
    (muse-spark-stop)))
