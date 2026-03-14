import { QRCodeGenerator } from "./qr-code-generator.js";

export class QRBoxCard {
  constructor(root, callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    this.generator = null;
    this.invite = null;
    this.renderShell();
  }

  renderShell() {
    this.root.innerHTML = `
      <div class="invite-qr-card">
        <div class="invite-qr-card__pulse"></div>
        <div class="invite-qr-card__canvas-wrap" id="invite-qr-canvas-wrap"></div>
        <p class="invite-qr-card__label">Room Invite Code</p>
        <code class="invite-qr-card__code" id="invite-room-code">--------</code>
        <p class="invite-qr-card__status" id="invite-qr-status" hidden></p>
        <div class="invite-qr-card__actions">
          <button class="button button--ghost" type="button" data-invite-action="copy-code">Copy Room Code</button>
          <button class="button button--ghost" type="button" data-invite-action="copy-link">Copy Invite Link</button>
          <button class="button button--primary" type="button" data-invite-action="download">Download QR as PNG</button>
        </div>
      </div>
    `;

    this.code = this.root.querySelector("#invite-room-code");
    this.canvasWrap = this.root.querySelector("#invite-qr-canvas-wrap");
    this.status = this.root.querySelector("#invite-qr-status");
    this.generator = new QRCodeGenerator(this.canvasWrap);

    this.root.querySelectorAll("[data-invite-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.inviteAction;
        if (action === "copy-code") {
          this.callbacks.onCopyCode?.(this.invite);
        }
        if (action === "copy-link") {
          this.callbacks.onCopyLink?.(this.invite);
        }
        if (action === "download") {
          this.callbacks.onDownload?.(this.invite, this.generator);
        }
      });
    });
  }

  async setInvite(invite) {
    this.invite = invite;
    this.code.textContent = invite?.roomId || "--------";
    this.status.hidden = true;
    this.status.textContent = "";

    if (!invite) {
      this.generator.lastValue = "";
      this.canvasWrap.innerHTML = "";
      this.generator = new QRCodeGenerator(this.canvasWrap);
      return;
    }

    try {
      await this.generator.render(invite.inviteUrl);
    } catch (error) {
      this.status.hidden = false;
      this.status.textContent = error.message || "Unable to render QR code.";
      this.callbacks.onError?.(this.status.textContent, invite);
    }
  }
}
