const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");

// ===== ENV (CHỈ TOKEN) =====
const TOKEN = process.env.TOKEN;

// ===== CONFIG (SỬA ID TẠI ĐÂY) =====
const CHANNEL_ID = "1472440293940002828";
const ROLE_TT = "1467725396433834149";
const ROLE_NV = "1467724655766012129";
const ROLE_RESET = "1475815959616032883";

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ===== DATA =====
const FILE = "./duty.json";
let duty = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {};

function save() {
  fs.writeFileSync(FILE, JSON.stringify(duty, null, 2));
}

function vnTime(date = new Date()) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function isGTA(p) {
  if (!p?.activities) return false;
  return p.activities.some(a =>
    a.name?.toLowerCase().includes("gta5vn")
  );
}

function ensure(id) {
  if (!duty[id]) {
    duty[id] = {
      on: false,
      start: 0,
      lastChange: 0,
      plate: "",
      ttMinutes: 0
    };
  }
}

async function sendEmbed(member, type, start, end, totalMin) {
  const data = duty[member.id];
  const ttHours = Math.floor(data.ttMinutes / 60);

  let desc =
`Tên nhân sự: ${member}

Biển số: ${data.plate || "Chưa khai báo"}

Thời gian onduty:
${vnTime(start)} → ${end ? vnTime(end) : "..."}

Tổng thời gian: ${totalMin || 0} phút

Trạng thái: ${type === "on" ? "Đang trực" : "Đã nghỉ"}`;

  if (member.roles.cache.has(ROLE_TT)) {
    desc += `

Tổng thời gian thực tập: ${ttHours} giờ`;
  }

  const embed = new EmbedBuilder()
    .setColor(type === "on" ? "#00ff88" : "#ff4444")
    .setTitle(type === "on" ? "BẢNG ONDUTY" : "BẢNG OFFDUTY")
    .setDescription(desc);

  const ch = client.channels.cache.get(CHANNEL_ID);
  if (ch) await ch.send({ embeds: [embed] });
}

async function checkPromote(member) {
  const data = duty[member.id];
  const hours = data.ttMinutes / 60;

  if (hours >= 60 && member.roles.cache.has(ROLE_TT)) {
    await member.roles.remove(ROLE_TT);
    await member.roles.add(ROLE_NV);

    const ch = client.channels.cache.get(CHANNEL_ID);
    if (ch) ch.send(`🎉 ${member} đã đủ 60h thực tập và trở thành Nhân viên!`);
  }
}

// ===== PRESENCE GTA DETECT =====
client.on("presenceUpdate", async (oldP, newP) => {
  const member = newP.member;
  if (!member) return;

  ensure(member.id);
  const data = duty[member.id];
  const now = Date.now();

  const playing = isGTA(newP);

  if (playing) {
    data.lastChange = now;

    if (!data.on) {
      data.on = true;
      data.start = now;
      save();
      sendEmbed(member, "on", new Date(now));
    }
  }

  if (!playing && data.on) {
    const end = now;
    const minutes = Math.floor((end - data.start) / 60000);

    if (member.roles.cache.has(ROLE_TT))
      data.ttMinutes += minutes;

    data.on = false;
    save();

    sendEmbed(member, "off", new Date(data.start), new Date(end), minutes);
    checkPromote(member);
  }
});

// ===== AFK 10 MIN =====
setInterval(async () => {
  const now = Date.now();

  for (const id in duty) {
    const data = duty[id];
    if (!data.on) continue;

    if (now - data.lastChange > 10 * 60 * 1000) {
      const guild = client.guilds.cache.first();
      const member = await guild.members.fetch(id).catch(() => null);
      if (!member) continue;

      const end = now;
      const minutes = Math.floor((end - data.start) / 60000);

      if (member.roles.cache.has(ROLE_TT))
        data.ttMinutes += minutes;

      data.on = false;
      save();

      sendEmbed(member, "off", new Date(data.start), new Date(end), minutes);
      checkPromote(member);
    }
  }
}, 60000);

// ===== COMMAND =====
client.on("messageCreate", async msg => {
  if (msg.author.bot) return;
  const member = msg.member;
  ensure(member.id);

  if (msg.content.startsWith("!plate")) {
    const plate = msg.content.replace("!plate", "").trim();
    duty[member.id].plate = plate;
    save();
    msg.reply("Đã lưu biển số");
  }

  if (msg.content.startsWith("!onduty")) {
    duty[member.id].on = true;
    duty[member.id].start = Date.now();
    duty[member.id].lastChange = Date.now();
    save();
    sendEmbed(member, "on", new Date());
  }

  if (msg.content.startsWith("!offduty")) {
    const data = duty[member.id];
    if (!data.on) return;

    const end = Date.now();
    const minutes = Math.floor((end - data.start) / 60000);

    if (member.roles.cache.has(ROLE_TT))
      data.ttMinutes += minutes;

    data.on = false;
    save();

    sendEmbed(member, "off", new Date(data.start), new Date(end), minutes);
    checkPromote(member);
  }

  if (msg.content.startsWith("!resetduty")) {
    if (!member.roles.cache.has(ROLE_RESET))
      return msg.reply("Không có quyền");

    const target = msg.mentions.members.first();
    if (!target) return msg.reply("Tag người");

    duty[target.id] = {
      on: false,
      start: 0,
      lastChange: 0,
      plate: "",
      ttMinutes: 0
    };
    save();
    msg.reply("Đã reset duty");
  }
});

client.once("ready", () => console.log("✅ Bot ready"));
client.login(TOKEN);
