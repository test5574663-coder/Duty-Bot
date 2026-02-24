require("dotenv").config();
const fs = require("fs");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");

const TOKEN = process.env.TOKEN;

// ====== CONFIG ======
const ROLE_INTERN = "1467725396433834149";
const ROLE_EMPLOYEE = "1467724655766012129";
const PROMOTE_CHANNEL = "1472545636980101313";
const TIMEZONE = "Asia/Ho_Chi_Minh";
const GAME_NAME = "GTA5VN"; // tên game cần check
// ====================

// 🔴 PHẢI có Presence intent để đọc game
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// ===== DATABASE =====
let db = {};
if (fs.existsSync("data.json")) {
  db = JSON.parse(fs.readFileSync("data.json"));
}

function save() {
  fs.writeFileSync("data.json", JSON.stringify(db, null, 2));
}

function today() {
  return new Date().toLocaleDateString("vi-VN", { timeZone: TIMEZONE });
}

function now() {
  return new Date();
}

function formatTime(d) {
  return new Date(d).toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIMEZONE
  });
}

function secondsToHMS(sec) {
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function getUser(guildId, userId) {
  if (!db[guildId]) db[guildId] = {};
  if (!db[guildId][userId]) {
    db[guildId][userId] = {
      total: 0,
      today: 0,
      start: null,
      plate: "",
      date: today(),
      logs: [] // lưu mốc giờ
    };
  }
  return db[guildId][userId];
}

// ===== EMBED =====
function buildEmbed(member, data) {
  let status = data.start ? "🟢 Đang trực" : "🔴 Đã off";
  let color = data.start ? 0x00ff00 : 0xff0000;

  let history = "Chưa có";
  if (data.logs.length > 0) {
    history = data.logs.map(x => `• ${x}`).join("\n");
  }

  return new EmbedBuilder()
    .setTitle("📋 BẢNG ONDUTY")
    .setColor(color)
    .addFields(
      { name: "Tên", value: `<@${member.id}>`, inline: true },
      { name: "Biển số", value: data.plate || "Chưa ghi", inline: true },
      { name: "Ngày", value: data.date, inline: true },
      { name: "Tổng hôm nay", value: secondsToHMS(data.today), inline: true },
      { name: "Tổng tích lũy", value: secondsToHMS(data.total), inline: true },
      { name: "Trạng thái", value: status, inline: true },
      { name: "Mốc thời gian", value: history }
    )
    .setTimestamp();
}

async function sendOrUpdate(interaction, member, data) {
  const channel = interaction.channel;

  if (data.messageId) {
    try {
      const msg = await channel.messages.fetch(data.messageId);
      await msg.edit({ embeds: [buildEmbed(member, data)] });
      return;
    } catch {}
  }

  const msg = await channel.send({ embeds: [buildEmbed(member, data)] });
  data.messageId = msg.id;
}

// ===== CHECK GAME =====
function isPlayingGame(presence) {
  if (!presence || !presence.activities) return false;
  return presence.activities.some(a =>
    a.name?.toLowerCase().includes(GAME_NAME.toLowerCase())
  );
}

// ===== COMMAND =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const data = getUser(member.guild.id, member.id);

  // reset ngày mới
  if (data.date !== today()) {
    data.today = 0;
    data.start = null;
    data.logs = [];
    data.date = today();
  }

  // ===== ONDUTY =====
  if (interaction.commandName === "onduty") {
    if (data.start)
      return interaction.reply({ content: "Bạn đang onduty!", ephemeral: true });

    // check game
    if (!isPlayingGame(member.presence))
      return interaction.reply({ content: "❌ Bạn chưa vào game!", ephemeral: true });

    let plate = interaction.options.getString("bienso");
    if (plate) data.plate = plate;

    data.start = now();

    await interaction.reply({ content: "✅ Bắt đầu onduty", ephemeral: true });
    await sendOrUpdate(interaction, member, data);
    save();
  }

  // ===== OFFDUTY =====
  if (interaction.commandName === "offduty") {
    if (!data.start)
      return interaction.reply({ content: "Bạn chưa onduty!", ephemeral: true });

    let end = now();
    let diff = Math.floor((end - new Date(data.start)) / 1000);

    data.today += diff;
    data.total += diff;

    // lưu mốc giờ
    data.logs.push(`${formatTime(data.start)} → ${formatTime(end)}`);

    data.start = null;

    await interaction.reply({ content: "⛔ Offduty", ephemeral: true });
    await sendOrUpdate(interaction, member, data);
    save();
  }

  // ===== RESET =====
  if (interaction.commandName === "resetduty") {
    if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild))
      return interaction.reply({ content: "Không có quyền", ephemeral: true });

    data.today = 0;
    data.total = 0;
    data.start = null;
    data.logs = [];

    await interaction.reply({ content: "♻️ Reset duty", ephemeral: true });
    await sendOrUpdate(interaction, member, data);
    save();
  }

  // ===== FORCE OFF (ADMIN) =====
  if (interaction.commandName === "forceoff") {
    if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild))
      return interaction.reply({ content: "Không có quyền", ephemeral: true });

    if (!data.start)
      return interaction.reply({ content: "Người này chưa onduty", ephemeral: true });

    let end = now();
    let diff = Math.floor((end - new Date(data.start)) / 1000);

    data.today += diff;
    data.total += diff;
    data.logs.push(`${formatTime(data.start)} → ${formatTime(end)}`);
    data.start = null;

    await interaction.reply({ content: "⛔ Đã force off", ephemeral: true });
    await sendOrUpdate(interaction, member, data);
    save();
  }
});

// ===== AUTO OFF KHI OUT GAME =====
client.on("presenceUpdate", (oldP, newP) => {
  if (!newP?.member) return;

  const guildId = newP.guild.id;
  const userId = newP.member.id;
  const data = db[guildId]?.[userId];
  if (!data || !data.start) return;

  // nếu không còn chơi game → off
  if (!isPlayingGame(newP)) {
    let end = now();
    let diff = Math.floor((end - new Date(data.start)) / 1000);

    data.today += diff;
    data.total += diff;
    data.logs.push(`${formatTime(data.start)} → ${formatTime(end)}`);
    data.start = null;
    save();
  }
});

client.once("ready", () => {
  console.log("Bot ready");
});

client.login(TOKEN);

// keep alive
const app = express();
app.get("/", (req, res) => res.send("Bot alive"));
app.listen(3000);
