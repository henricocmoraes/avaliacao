import { randomBytes, scryptSync } from 'node:crypto';

if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  console.error('Execute este script em um terminal interativo.');
  process.exit(1);
}

const input = process.stdin;
const output = process.stdout;
let password = '';
output.write('Crie uma senha forte (mínimo 14 caracteres): ');
input.setRawMode(true);
input.resume();
input.setEncoding('utf8');
input.on('data', chunk => {
  for (const char of chunk) {
    if (char === '\u0003') { output.write('\n'); process.exit(130); }
    if (char === '\r' || char === '\n') {
      output.write('\n');
      input.setRawMode(false);
      input.pause();
      if (password.length < 14) { console.error('Senha muito curta. Use pelo menos 14 caracteres.'); process.exit(1); }
      const salt = randomBytes(16);
      const hash = scryptSync(password, salt, 64);
      password = '';
      console.log(`scrypt$${salt.toString('base64')}$${hash.toString('base64')}`);
      process.exit(0);
    }
    if (char === '\u007f' || char === '\b') { password = password.slice(0, -1); continue; }
    password += char;
  }
});
