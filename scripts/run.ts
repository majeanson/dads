import { execFileSync } from 'node:child_process';

/**
 * Runs an npm-installed CLI (`npx wrangler …`, `npx tsx …`) and returns stdout.
 *
 * On Windows `npx` is a .cmd shim, which needs a shell — and with a shell,
 * Node passes the arguments through unquoted, so `--name "The Dads"` arrives
 * as `--name The Dads`. Quote them ourselves. POSIX gets execFile's exact
 * argv semantics and needs nothing.
 */
export function run(cmd: string, args: string[], stdout: 'pipe' | 'inherit' = 'pipe'): string {
  const win = process.platform === 'win32';
  const argv = win ? args.map(quoteForCmd) : args;
  const out = execFileSync(cmd, argv, {
    encoding: 'utf8',
    stdio: ['ignore', stdout, 'inherit'],
    shell: win,
  });
  return out ?? '';
}

function quoteForCmd(arg: string): string {
  if (arg === '' || /[\s"&|<>^()]/.test(arg)) return `"${arg.replace(/"/g, '\\"')}"`;
  return arg;
}
