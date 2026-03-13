import { QRBoxCard } from "./qr-box-card.js";

export class InviteSidePanel {
  constructor(root, callbacks = {}) {
    this.root = root;
    this.callbacks = callbacks;
    this.invite = null;
    this.minimized = false;
    this.render();
  }

  render() {
    this.root.innerHTML = `
      <div class="invite-panel" data-state="hidden">
        <button class="invite-panel__tab" type="button">Invite</button>
        <div class="invite-panel__surface">
          <div class="invite-panel__header">
            <div>
              <p class="panel__kicker">Invite lobby</p>
              <h3 id="invite-panel-room-name">New room</h3>
            </div>
            <button class="button button--ghost invite-panel__minimize" type="button">Minimize</button>
          </div>
          <div class="invite-panel__card-root"></div>
        </div>
      </div>
    `;

    this.panel = this.root.querySelector(".invite-panel");
    this.tab = this.root.querySelector(".invite-panel__tab");
    this.surface = this.root.querySelector(".invite-panel__surface");
    this.title = this.root.querySelector("#invite-panel-room-name");
    this.card = new QRBoxCard(this.root.querySelector(".invite-panel__card-root"), this.callbacks);

    this.tab.addEventListener("click", () => {
      this.minimized = false;
      this.syncState();
    });

    this.root.querySelector(".invite-panel__minimize").addEventListener("click", () => {
      this.minimized = true;
      this.syncState();
    });
  }

  async setInvite(invite) {
    this.invite = invite;
    this.title.textContent = invite?.roomName || "Room invite";
    await this.card.setInvite(invite);
    this.minimized = false;
    this.syncState();
  }

  hide() {
    this.invite = null;
    this.minimized = false;
    this.panel.dataset.state = "hidden";
  }

  syncState() {
    if (!this.invite) {
      this.panel.dataset.state = "hidden";
      return;
    }

    this.panel.dataset.state = this.minimized ? "minimized" : "visible";
  }
}
