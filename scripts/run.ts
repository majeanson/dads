import { execFileSync, execSync, type ExecSyncOptionsWithStringEncoding } from 'node:child_process';

/**
 * Runs an npm-installed CLI (`npx wrangler …`, `npx tsx …`) and returns stdout.
 *
 * On Windows `npx` is a .cmd shim, which needs a shell. Handing an argument
 * array to a shell is deprecated (DEP0190) because Node only joins it with
 * spaces, so `--name "The Dads"` would arrive as `--name The Dads`: build the
 * one command line ourselves, quoted. POSIX gets execFile's exact argv
 * semantics and no shell at all.
 */
export function run(cmd: string, args: string[], stdout: 'pipe' | 'inherit' = 'pipe'): string {
  const options: ExecSyncOptionsWithStringEncoding = {
    encoding: 'utf8',
    stdio: ['ignore', stdout, 'inherit'],
  };
  const out =
    process.platform === 'win32'
      ? execSync([cmd, ...args].map(quoteForCmd).join(' '), options)
      : execFileSync(cmd, args, options);
  return out ?? '';
}

function quoteForCmd(arg: string): string {
  if (arg === '' || /[\s"&|<>^()]/.test(arg)) return `"${arg.replace(/"/g, '\\"')}"`;
  return arg;
}
