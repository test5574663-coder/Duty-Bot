
const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.TOKEN;
const RESET_ROLES = ["1475815959616032883"]; // role được phép reset/force off

const DATA_FILE = "duty.json";
let db = {};

if (fs.existsSync(DATA_FILE)) {
  db = JSON.parse(fs.readFileSync(DATA_FILE));
}

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function now() {
  return Date.now();
}

function fmtTime(ts) {
  const d = new Date(ts);
  return `${d.getHours()}h${d.getMinutes()}`;
}

function isPlayingGTA(member) {
  if (!member?.presence?.activities) return false;

  return member.presence.activities.some(a => {
    const name = (a.name || "").toLowerCase();
    const details = (a.details || "").toLowerCase();
    const state = (a.state || "").toLowerCase();

    return (
      name.includes("gta5") ||
      name.includes("gta5vn") ||
      details.includes("gta5") ||
      details.includes("gta5vn") ||
      state.includes("gta5") ||
      state.includes("gta5vn")
    );
  });
}

function getUser(id) {
  if (!db[id]) {
    db[id] = {
      active: false,
      start: null,
      sessions: [],
      total: 0
    };
  }
  return db[id];
}

function buildEmbed(member, data) {
  let desc = "";

  data.sessions.forEach(s => {
    desc += `• ${fmtTime(s.start)} → ${fmtTime(s.end)}\n`;
  });

  if (data.active) {
    desc += `• ${fmtTime(data.start)} → ...`;
  }

  const color = data.active ? 0x00ff88 : 0xff0000;

  return new EmbedBuilder()
    .setTitle("BẢNG ONDUTY")
    .setColor(color)
    .addFields(
      { name: "Tên", value: `<@${member.id}>` },
      { name: "Tổng", value: Math.floor(data.total/60000) + " phút" },
      { name: "Trạng thái", value: data.active ? "Đang trực" : "Off duty" },
      { name: "Timeline", value: desc || "Chưa có" }
    );
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

client.on("ready", () => {
  console.log("Bot ready");
});

client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const member = i.member;
  const data = getUser(member.id);

  if (i.commandName === "onduty") {
    if (!isPlayingGTA(member)) {
      return i.reply({ content: "❌ Bạn chưa vào game!", ephemeral: true });
    }

    if (!data.active) {
      data.active = true;
      data.start = now();
      save();
    }

    return i.reply({ embeds: [buildEmbed(member, data)] });
  }

  if (i.commandName === "offduty") {
    if (data.active) {
      const end = now();
      data.sessions.push({ start: data.start, end });
      data.total += end - data.start;
      data.active = false;
      data.start = null;
      save();
    }

    return i.reply({ embeds: [buildEmbed(member, data)] });
  }

  if (i.commandName === "resetduty") {
    if (!member.roles.cache.some(r => RESET_ROLES.includes(r.id))) {
      return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    }

    db[member.id] = {
      active: false,
      start: null,
      sessions: [],
      total: 0
    };
    save();

    return i.reply({ content: "✅ Đã reset duty", ephemeral: true });
  }

  if (i.commandName === "forceoff") {
    if (!member.roles.cache.some(r => RESET_ROLES.includes(r.id))) {
      return i.reply({ content: "❌ Không có quyền", ephemeral: true });
    }

    if (data.active) {
      const end = now();
      data.sessions.push({ start: data.start, end });
      data.total += end - data.start;
      data.active = false;
      data.start = null;
      save();
    }

    return i.reply({ content: "⛔ Đã đóng onduty", ephemeral: true });
  }
});

client.on("presenceUpdate", (oldP, newP) => {
  const member = newP?.member;
  if (!member) return;

  const data = getUser(member.id);
  if (!data.active) return;

  if (!isPlayingGTA(member)) {
    const end = now();
    data.sessions.push({ start: data.start, end });
    data.total += end - data.start;
    data.active = false;
    data.start = null;
    save();
  }
});

client.login(TOKEN);
