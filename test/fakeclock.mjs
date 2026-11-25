// Reloj falso para grabar el vídeo: FAKE_NOW='2026-12-03T11:00:00+01:00'
if (process.env.FAKE_NOW) {
  const OFF = Date.parse(process.env.FAKE_NOW) - Date.now();
  const R = Date;
  class FD extends R {
    constructor(...a) { if (a.length) super(...a); else super(R.now() + OFF); }
    static now() { return R.now() + OFF; }
  }
  globalThis.Date = FD;
}
