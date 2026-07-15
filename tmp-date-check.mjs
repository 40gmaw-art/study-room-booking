import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const sourcePath = path.resolve('lib/booking.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
});
const module = { exports: {} };
const fn = new Function('require', 'module', 'exports', outputText);
fn(require, module, module.exports);
const booking = module.exports;

const samples = ['2026-07-06', '2026-07-08', '2026-07-10', '2026-07-11', '2026-07-12'];
for (const date of samples) {
  const result = booking.getBookingDateOptions().filter((option) => option.date >= date && option.date <= '2026-07-17' && option.enabled).map((option) => option.date);
  console.log(`${date} => ${result.join(', ')}`);
}
