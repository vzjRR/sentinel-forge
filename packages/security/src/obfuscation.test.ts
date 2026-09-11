import { describe, expect, it } from 'vitest';
import { analyzeObfuscation } from './obfuscation.js';

describe('obfuscation indicators', () => {
  it('reports nothing for ordinary readable code', () => {
    const source = [
      'local Config = {}',
      'Config.Locale = "en"',
      '',
      'CreateThread(function()',
      '    while true do',
      '        Wait(1000)',
      '        updateDisplay(Config.Locale)',
      '    end',
      'end)',
    ].join('\n');
    const analysis = analyzeObfuscation(source);
    expect(analysis.reportable).toBe(false);
    expect(analysis.indicators).toEqual([]);
  });

  it('detects a decode chain feeding a loader', () => {
    const source = ["local blob = 'ZnVuY3Rpb24gZigpIHJldHVybiAxIGVuZA=='", 'local code = FromBase64(blob)', 'load(code)'].join('\n');
    const analysis = analyzeObfuscation(source);
    expect(analysis.indicators.some((indicator) => indicator.kind === 'DECODE_CHAIN')).toBe(true);
    expect(analysis.reportable).toBe(true);
  });

  it('detects a high density of encoded literals', () => {
    const encoded = Array.from(
      { length: 12 },
      (_value, index) => `local s${String(index)} = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY3ODkw${String(index)}'`,
    ).join('\n');
    const analysis = analyzeObfuscation(encoded);
    expect(analysis.indicators.some((indicator) => indicator.kind === 'ENCODED_STRING_DENSITY')).toBe(true);
  });

  it('does not report a single encoded blob as obfuscation', () => {
    // One embedded asset is data, not a transformation.
    const source = [
      "local icon = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'",
      "local name = 'sf_core'",
      "local locale = 'en'",
      "local version = '1.0.0'",
      "local author = 'fixture'",
      "local description = 'a resource'",
      "local license = 'proprietary'",
      "local url = 'https://example.invalid'",
      "local greeting = 'hello'",
    ].join('\n');
    expect(analyzeObfuscation(source).reportable).toBe(false);
  });

  it('detects opaque identifiers', () => {
    const source = Array.from({ length: 30 }, (_value, index) => `local _0x${String(index)}a2f = ${String(index)}`).join('\n');
    const analysis = analyzeObfuscation(source);
    expect(analysis.indicators.some((indicator) => indicator.kind === 'OPAQUE_IDENTIFIERS')).toBe(true);
  });

  it('detects character-by-character string reconstruction', () => {
    const source = Array.from({ length: 6 }, () => 'x = x .. string.char(72)').join('\n');
    expect(analyzeObfuscation(source).indicators.some((indicator) => indicator.kind === 'CHARACTER_RECONSTRUCTION')).toBe(true);
  });

  it('treats a single long line as weak evidence on its own', () => {
    // Minified JavaScript bundled into a resource is not obfuscation.
    const analysis = analyzeObfuscation(`local data = "${'x'.repeat(2500)}"`);
    expect(analysis.indicators.some((indicator) => indicator.kind === 'LONG_SINGLE_LINE')).toBe(true);
    expect(analysis.reportable).toBe(false);
  });

  it('scores more indicators higher', () => {
    const weak = analyzeObfuscation(`local data = "${'x'.repeat(2500)}"`);
    const strong = analyzeObfuscation(
      ["local blob = 'ZnVuY3Rpb24gZigpIHJldHVybiAxIGVuZA=='", 'local code = FromBase64(blob)', 'load(code)'].join('\n'),
    );
    expect(strong.score).toBeGreaterThan(weak.score);
  });

  it('never throws on hostile input', () => {
    for (const content of ['', '[[', "'", 'a'.repeat(50_000)]) {
      expect(() => analyzeObfuscation(content)).not.toThrow();
    }
  });
});
