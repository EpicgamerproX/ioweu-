export class QRCodeGenerator {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "invite-qr__canvas";
    this.container.replaceChildren(this.canvas);
    this.lastValue = "";
  }

  async render(value) {
    if (!value || value === this.lastValue) {
      return;
    }

    if (!window.QRCode?.toCanvas) {
      throw new Error("QR code library failed to load.");
    }

    await window.QRCode.toCanvas(this.canvas, value, {
      width: 220,
      margin: 1,
      color: {
        dark: "#24160d",
        light: "#ffffff"
      }
    });

    this.lastValue = value;
  }

  download(filename = "room-invite-qr.png") {
    const link = document.createElement("a");
    link.href = this.canvas.toDataURL("image/png");
    link.download = filename;
    link.click();
  }
}
