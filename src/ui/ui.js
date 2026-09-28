// DOM-based UI: screens, HUD updates, settings panel and toasts.
// The game calls into this; UI raises events back through the `handlers` object.

const $ = (id) => document.getElementById(id);

const SCREENS = ['screen-menu', 'screen-settings', 'screen-offer', 'screen-pause', 'screen-complete', 'screen-failed'];

export function formatMoney(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatDistance(m) {
  return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export class UI {
  constructor(handlers) {
    this.handlers = handlers;
    this.settingsReturn = 'screen-menu';
    this.toastTimer = null;
    this.hudCache = {};

    // Every button plays the UI click (handlers.click) then its action.
    const bind = (id, fn) => {
      $(id).addEventListener('click', () => {
        handlers.click();
        fn();
      });
    };
    bind('btn-play', () => handlers.play());
    bind('btn-settings', () => this.openSettings('screen-menu'));
    bind('btn-fullscreen', () => handlers.fullscreen());
    bind('btn-settings-back', () => this.closeSettings());
    bind('btn-offer-back', () => handlers.toMenu());
    bind('btn-offer-accept', () => handlers.acceptJob());
    bind('btn-resume', () => handlers.resume());
    bind('btn-restart', () => handlers.restart());
    bind('btn-pause-settings', () => this.openSettings('screen-pause'));
    bind('btn-pause-menu', () => handlers.toMenu());
    bind('btn-next', () => handlers.nextJob());
    bind('btn-complete-menu', () => handlers.toMenu());
    bind('btn-retry', () => handlers.restart());
    bind('btn-failed-menu', () => handlers.toMenu());
    // Two-tap confirmation built into the button (no blocking browser dialogs).
    let resetArmed = null;
    bind('btn-reset-progress', () => {
      const btn = $('btn-reset-progress');
      if (resetArmed) {
        clearTimeout(resetArmed);
        resetArmed = null;
        btn.textContent = 'Reset save';
        handlers.resetProgress();
        return;
      }
      btn.textContent = 'Tap again to reset';
      resetArmed = setTimeout(() => {
        resetArmed = null;
        btn.textContent = 'Reset save';
      }, 3000);
    });
    bind('btn-rotate-dismiss', () => {
      this.rotateDismissed = true;
      $('rotate-hint').classList.add('hidden');
    });

    // Settings inputs
    $('set-audio').addEventListener('change', (e) => handlers.setSetting('audio', e.target.checked));
    $('set-sfx').addEventListener('change', (e) => handlers.setSetting('sfx', e.target.checked));
    $('set-fps').addEventListener('change', (e) => handlers.setSetting('showFps', e.target.checked));
    $('set-quality').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        handlers.click();
        handlers.setSetting('quality', b.dataset.q);
      })
    );

    this.rotateDismissed = false;
    const checkOrientation = () => {
      const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 700;
      $('rotate-hint').classList.toggle('hidden', !portrait || this.rotateDismissed);
    };
    window.addEventListener('resize', checkOrientation);
    checkOrientation();
  }

  showScreen(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  }

  setDrivingUI(visible) {
    $('hud').classList.toggle('hidden', !visible);
    $('controls').classList.toggle('hidden', !visible);
  }

  openSettings(returnTo) {
    this.settingsReturn = returnTo;
    this.showScreen('screen-settings');
  }

  closeSettings() {
    this.showScreen(this.settingsReturn);
  }

  syncSettings(settings) {
    $('set-audio').checked = settings.audio;
    $('set-sfx').checked = settings.sfx;
    $('set-fps').checked = settings.showFps;
    $('set-quality')
      .querySelectorAll('button')
      .forEach((b) => b.classList.toggle('active', b.dataset.q === settings.quality));
    $('fps').classList.toggle('hidden', !settings.showFps);
  }

  updateMenuStats(save) {
    $('menu-money').textContent = formatMoney(save.money);
    $('menu-deliveries').textContent = save.deliveriesCompleted;
  }

  showOffer(mission, fromName) {
    $('offer-from').textContent = fromName;
    $('offer-to').textContent = mission.job.destination;
    $('offer-cargo').textContent = mission.job.cargo;
    $('offer-distance').textContent = mission.routeKm.toFixed(2) + ' km';
    $('offer-pay').textContent = formatMoney(mission.basePay);
    this.showScreen('screen-offer');
  }

  showComplete(result, balance) {
    $('res-base').textContent = formatMoney(result.basePay);
    $('res-bonus').textContent = '+' + formatMoney(result.timeBonus);
    $('res-damage').textContent = `-${formatMoney(result.damagePenalty)} (${Math.round(result.damagePct)}%)`;
    $('res-time').textContent = formatTime(result.time);
    $('res-total').textContent = formatMoney(result.total);
    $('res-balance').textContent = formatMoney(balance);
    this.showScreen('screen-complete');
  }

  showFailed(reason) {
    $('fail-reason').textContent = reason;
    this.showScreen('screen-failed');
  }

  /** Only touch the DOM when a value actually changes (cheap on mobile). */
  setText(id, value) {
    if (this.hudCache[id] !== value) {
      this.hudCache[id] = value;
      $(id).textContent = value;
    }
  }

  updateHUD({ speedKmh, gear, condition, objective, distance, bearing, money, unload, inZone }) {
    this.setText('hud-speed', String(Math.round(speedKmh)));
    this.setText('hud-gear', gear);
    this.setText('hud-objective', objective);
    this.setText('hud-distance', inZone ? 'Stop inside the marker' : formatDistance(distance));
    this.setText('hud-money', formatMoney(money));
    this.setText('hud-condition', `Condition ${Math.round(condition)}%`);

    if (this.hudCache.gearClass !== gear) {
      this.hudCache.gearClass = gear;
      $('hud-gear').classList.toggle('reverse', gear === 'R');
      const g = $('ctrl-gear');
      g.classList.toggle('drive', gear === 'D');
      g.classList.toggle('reverse', gear === 'R');
    }
    const condBar = $('hud-condition-bar');
    const cw = Math.round(condition) + '%';
    if (condBar.style.width !== cw) {
      condBar.style.width = cw;
      condBar.style.background = condition > 60 ? 'var(--good)' : condition > 30 ? 'var(--accent)' : 'var(--bad)';
    }
    $('hud-arrow').style.transform = `rotate(${bearing}rad)`;

    const showUnload = unload > 0;
    if (this.hudCache.unloadVisible !== showUnload) {
      this.hudCache.unloadVisible = showUnload;
      $('hud-unload').classList.toggle('hidden', !showUnload);
    }
    if (showUnload) $('hud-unload-bar').style.width = Math.round(unload * 100) + '%';
  }

  setFps(fps) {
    this.setText('fps', `${fps} fps`);
  }

  toast(message, duration = 1600) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.add('hidden'), duration);
  }
}
