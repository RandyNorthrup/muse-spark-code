// Receives only the PID of the generated canary process started by the capture.
// It never enumerates processes or reads an existing process's memory.
import Darwin

guard CommandLine.arguments.count == 2, let pid = Int32(CommandLine.arguments[1]), pid > 0 else {
    exit(1)
}
var task: mach_port_t = 0
let status = task_for_pid(mach_task_self_, pid, &task)
print("task_for_pid status=\(status)")
if status == KERN_SUCCESS {
    // Access is already proved by the task right; no bytes need to be read.
    mach_port_deallocate(mach_task_self_, task)
    print("same-user task access permitted; retain memory-read residual")
} else {
    print("same-user task access refused for this canary process and this reader")
}
