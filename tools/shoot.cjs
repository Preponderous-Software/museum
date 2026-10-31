// node tools/shoot.cjs <url> <out.png> [placements JSON]: renders the museum
// headless (SwiftShader) with the kit's ?drive=1 and saves frames. Each
// placement is {x, z, yaw, pitch, out} or {hall, out} or {at, out}.
// Run with NODE_PATH pointing at a playwright install.
const {chromium} = require("playwright");
(async () => {
  const [url, out, shotsJson] = process.argv.slice(2);
  const shots = shotsJson ? JSON.parse(shotsJson) : [{out}];
  const browser = await chromium.launch({executablePath: process.env.CHROME,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});
  const page = await browser.newPage({viewport: {width: 1280, height: 720}});
  page.on("console", (m) => console.log("page:", m.text()));
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  await page.goto(url + (url.includes("?") ? "&" : "?") + "drive=1&quality=1", {waitUntil: "commit"});
  await page.waitForFunction(() => window.__museum && window.__strataKit && window.__strataKit.ready, null, {timeout: 120000});
  const cdp = await page.context().newCDPSession(page);
  for (const s of shots) {
    await page.evaluate((s) => {
      const m = window.__museum;
      if (s.hall) m.goToHall(m.building.halls.find((h) => h.id === s.hall));
      else if (s.at) m.goToExhibit(m.building.exhibits.find((x) => x.ref.title === s.at));
      else if (s.x != null) Object.assign(m.visitor, {x: s.x, z: s.z, yaw: s.yaw, pitch: s.pitch || 0});
      window.__strataKit.cam.yaw = m.visitor.yaw; window.__strataKit.cam.pitch = m.visitor.pitch;
      window.__strataKit.drive(1); window.__strataKit.drive(1.05);
    }, s);
    const {data} = await cdp.send("Page.captureScreenshot", {format: "png"});
    require("fs").writeFileSync(s.out, Buffer.from(data, "base64"));
    console.log("wrote", s.out);
  }
  await browser.close();
})();
