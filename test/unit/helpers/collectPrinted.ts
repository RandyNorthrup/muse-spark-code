// Collected terminal output for command rigs: the printed lines, the
// error lines, and the two sinks that fill them.
export function collectPrinted(): {
  readonly printed: string[]
  readonly errors: string[]
  readonly print: (line: string) => void
  readonly printError: (line: string) => void
} {
  const printed: string[] = []
  const errors: string[] = []
  return {
    printed,
    errors,
    print: (line) => {
      printed.push(line)
    },
    printError: (line) => {
      errors.push(line)
    },
  }
}
