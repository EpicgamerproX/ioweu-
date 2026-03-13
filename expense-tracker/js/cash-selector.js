const BASE_VALUES = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
const RADIAL_VALUES = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 12;

export class CashSelector {
  constructor(root) {
    this.root = root;
    this.state = {
      holdTimer: null,
      pointerId: null,
      startPoint: null,
      baseValue: null,
      activeButton: null,
      overlayOpen: false,
      wheelCenter: { x: 0, y: 0 },
      pendingPoint: null,
      activeSegmentIndex: -1,
      rafId: 0,
      toastTimer: null
    };

    this.handleGlobalPointerMove = this.handleGlobalPointerMove.bind(this);
    this.handleGlobalPointerUp = this.handleGlobalPointerUp.bind(this);
    this.flushPointerMove = this.flushPointerMove.bind(this);

    this.render();
    this.bindEvents();
  }

  render() {
    const buttonMarkup = BASE_VALUES.map((value) => `
      <button class="cash-selector__button" type="button" data-base-value="${value}">
        ${value}
      </button>
    `).join("");

    const segmentMarkup = RADIAL_VALUES.map((value, index) => {
      const angle = -90 + index * (360 / RADIAL_VALUES.length);
      const radians = angle * (Math.PI / 180);
      const x = Math.cos(radians) * 86;
      const y = Math.sin(radians) * 86;

      return `
        <div
          class="cash-selector__segment"
          data-segment-index="${index}"
          style="transform: translate(${x}px, ${y}px) rotate(${angle + 90}deg);"
        >
          ${value}
        </div>
      `;
    }).join("");

    this.root.innerHTML = `
      <div class="cash-selector">
        <div class="cash-selector__grid">
          ${buttonMarkup}
        </div>
        <div class="cash-selector__overlay">
          <div class="cash-selector__veil"></div>
          <div class="cash-selector__focus"></div>
          <div class="cash-selector__wheel">
            ${segmentMarkup}
          </div>
        </div>
        <div class="cash-selector__toast" aria-live="polite"></div>
      </div>
    `;

    this.elements = {
      container: this.root.querySelector(".cash-selector"),
      buttons: Array.from(this.root.querySelectorAll(".cash-selector__button")),
      overlay: this.root.querySelector(".cash-selector__overlay"),
      focus: this.root.querySelector(".cash-selector__focus"),
      wheel: this.root.querySelector(".cash-selector__wheel"),
      segments: Array.from(this.root.querySelectorAll(".cash-selector__segment")),
      toast: this.root.querySelector(".cash-selector__toast")
    };
  }

  bindEvents() {
    this.elements.buttons.forEach((button) => {
      button.addEventListener("pointerdown", (event) => this.handleButtonPointerDown(event, button));
      button.addEventListener("pointermove", (event) => this.handleButtonPointerMove(event));
      button.addEventListener("pointerup", (event) => this.handleButtonPointerUp(event, button));
      button.addEventListener("pointercancel", () => this.cancelHold());
      button.addEventListener("pointerleave", () => this.handleButtonPointerLeave());
    });
  }

  handleButtonPointerDown(event, button) {
    event.preventDefault();

    this.cancelHold();
    this.state.pointerId = event.pointerId;
    this.state.startPoint = { x: event.clientX, y: event.clientY };
    this.state.baseValue = Number(button.dataset.baseValue);
    this.state.activeButton = button;

    button.classList.add("is-pressed");

    this.state.holdTimer = window.setTimeout(() => {
      this.openWheel(button);
    }, LONG_PRESS_MS);
  }

  handleButtonPointerMove(event) {
    if (!this.state.holdTimer || !this.state.startPoint) {
      return;
    }

    const movedX = event.clientX - this.state.startPoint.x;
    const movedY = event.clientY - this.state.startPoint.y;
    if (Math.hypot(movedX, movedY) > MOVE_CANCEL_PX) {
      this.cancelHold();
    }
  }

  handleButtonPointerLeave() {
    if (!this.state.overlayOpen) {
      this.cancelHold();
    }
  }

  handleButtonPointerUp(event, button) {
    if (this.state.overlayOpen) {
      return;
    }

    const shouldEmitBase = Boolean(this.state.holdTimer)
      && this.state.activeButton === button
      && this.state.pointerId === event.pointerId;

    this.cancelHold();

    if (!shouldEmitBase) {
      return;
    }

    const baseValue = Number(button.dataset.baseValue || 0);
    this.emitSelection(baseValue, 0);
  }

  openWheel(button) {
    if (!this.state.baseValue || !button) {
      return;
    }

    this.state.overlayOpen = true;
    this.state.holdTimer = null;
    button.classList.remove("is-pressed");
    button.classList.add("is-active-base");

    const containerRect = this.elements.container.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const rawX = buttonRect.left - containerRect.left + (buttonRect.width / 2);
    const rawY = buttonRect.top - containerRect.top + (buttonRect.height / 2);
    const edgePadding = 130;

    this.state.wheelCenter = {
      x: clamp(rawX, edgePadding, containerRect.width - edgePadding),
      y: clamp(rawY, edgePadding, containerRect.height - edgePadding)
    };

    this.elements.focus.textContent = String(this.state.baseValue);
    this.positionOverlayElements();
    this.elements.overlay.classList.add("is-visible");
    this.elements.wheel.classList.add("is-visible");

    if (navigator.vibrate) {
      navigator.vibrate(18);
    }

    window.addEventListener("pointermove", this.handleGlobalPointerMove, { passive: false });
    window.addEventListener("pointerup", this.handleGlobalPointerUp, { passive: false });
    window.addEventListener("pointercancel", this.handleGlobalPointerUp, { passive: false });
  }

  positionOverlayElements() {
    const { x, y } = this.state.wheelCenter;
    this.elements.focus.style.left = `${x}px`;
    this.elements.focus.style.top = `${y}px`;
    this.elements.wheel.style.left = `${x}px`;
    this.elements.wheel.style.top = `${y}px`;
  }

  handleGlobalPointerMove(event) {
    if (!this.state.overlayOpen) {
      return;
    }

    event.preventDefault();
    this.state.pendingPoint = { x: event.clientX, y: event.clientY };
    if (!this.state.rafId) {
      this.state.rafId = window.requestAnimationFrame(this.flushPointerMove);
    }
  }

  flushPointerMove() {
    this.state.rafId = 0;
    if (!this.state.pendingPoint || !this.state.overlayOpen) {
      return;
    }

    const containerRect = this.elements.container.getBoundingClientRect();
    const pointX = this.state.pendingPoint.x - containerRect.left;
    const pointY = this.state.pendingPoint.y - containerRect.top;
    const dx = pointX - this.state.wheelCenter.x;
    const dy = pointY - this.state.wheelCenter.y;
    const radius = Math.hypot(dx, dy);

    if (radius < 42 || radius > 150) {
      this.setActiveSegment(-1);
      return;
    }

    let degrees = Math.atan2(dy, dx) * (180 / Math.PI);
    degrees = (degrees + 450) % 360;
    const segmentSize = 360 / RADIAL_VALUES.length;
    const index = Math.floor(((degrees + (segmentSize / 2)) % 360) / segmentSize);
    this.setActiveSegment(index);
  }

  setActiveSegment(index) {
    this.state.activeSegmentIndex = index;
    this.elements.segments.forEach((segment, segmentIndex) => {
      segment.classList.toggle("is-active", segmentIndex === index);
    });
  }

  handleGlobalPointerUp(event) {
    if (!this.state.overlayOpen) {
      this.cancelHold();
      return;
    }

    event.preventDefault();

    const radialValue = this.state.activeSegmentIndex >= 0
      ? RADIAL_VALUES[this.state.activeSegmentIndex]
      : 0;
    const baseValue = Number(this.state.baseValue || 0);
    this.closeWheel();
    this.emitSelection(baseValue, radialValue);
  }

  closeWheel() {
    window.removeEventListener("pointermove", this.handleGlobalPointerMove);
    window.removeEventListener("pointerup", this.handleGlobalPointerUp);
    window.removeEventListener("pointercancel", this.handleGlobalPointerUp);

    if (this.state.rafId) {
      window.cancelAnimationFrame(this.state.rafId);
      this.state.rafId = 0;
    }

    if (this.state.activeButton) {
      this.state.activeButton.classList.remove("is-active-base", "is-pressed");
    }

    this.elements.overlay.classList.remove("is-visible");
    this.elements.wheel.classList.remove("is-visible");
    this.setActiveSegment(-1);

    this.state.overlayOpen = false;
    this.state.baseValue = null;
    this.state.startPoint = null;
    this.state.pendingPoint = null;
    this.state.pointerId = null;
    this.state.activeButton = null;
  }

  cancelHold() {
    if (this.state.holdTimer) {
      window.clearTimeout(this.state.holdTimer);
      this.state.holdTimer = null;
    }

    if (this.state.activeButton && !this.state.overlayOpen) {
      this.state.activeButton.classList.remove("is-pressed");
    }

    if (!this.state.overlayOpen) {
      this.state.pointerId = null;
      this.state.startPoint = null;
      this.state.baseValue = null;
      this.state.activeButton = null;
    }
  }

  showToast(message) {
    if (this.state.toastTimer) {
      window.clearTimeout(this.state.toastTimer);
    }

    this.elements.toast.textContent = message;
    this.elements.toast.classList.add("is-visible");
    this.state.toastTimer = window.setTimeout(() => {
      this.elements.toast.classList.remove("is-visible");
    }, 1600);
  }

  emitSelection(baseValue, radialValue) {
    const amount = Number(baseValue || 0) + Number(radialValue || 0);
    const label = radialValue ? `${baseValue} + ${radialValue}` : `${baseValue}`;

    this.showToast(`Added ${label}`);
    this.root.dispatchEvent(new CustomEvent("cashValueSelected", {
      bubbles: true,
      detail: {
        amount,
        baseValue,
        radialValue,
        label,
        timestamp: new Date().toISOString()
      }
    }));
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
