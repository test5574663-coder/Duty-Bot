const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const express = require("express");

const TOKEN = process.env.TOKEN;

// ====== CONFIG ======
const ROLE_INTERN = "1467725396433834149";
const ROLE_EMPLOYEE = "1467724655766012129";
const PROMOTE_CHANNEL = "1472545636980101313";
const TIMEZONE = "Asia/Ho_Chi_Minh";
// ====================

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// ===== DATABASE =====
let db = {};
if (fs.existsSync("data.json")) db = JSON.parse(fs.readFileSync("data.json"));

function save() {
  fs.writeFileSync("data.json", JSON.stringify(db, null, 2));
}

function today() {
  return new Date().toLocaleDateString("vi-VN", { timeZone: TIMEZONE });
}

function now() {
  return new Date();
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
      messageId: null,
      channelId: null
    };
  }
  return db[guildId][userId];
}

// ===== GTA DETECT =====
function isPlayingGTA(member) {
  if (!member.presence || !member.presence.activities) return false;

  return member.presence.activities.some(a => {
    const name = (a.name || "").toLowerCase();
    const details = (a.details || "").toLowerCase();
    const state = (a.state || "").toLowerCase();

    const text = `${name} ${details} ${state}`;

    return text.includes("gta5vn") ||
           text.includes("gta v") ||
           text.includes("gta5") ||
           text.includes("grand theft auto");
  });
}

// ===== EMBED =====
function buildEmbed(member, data) {
  return new EmbedBuilder()
    .setTitle("📋 BẢNG ONDUTY")
    .setColor(data.start ? 0x00ff00 : 0xff0000)
    .addFields(
      { name: "Tên Nhân Sự", value: `<@${member.id}>`, inline: true },
      { name: "Biển Số", value: data.plate || "Chưa ghi", inline: true },
      { name: "Ngày Onduty", value: data.date, inline: true },
      { name: "Thời Gian Onduty", value: secondsToHMS(data.today), inline: true },
      { name: "Tổng Thời Gian Onduty", value: secondsToHMS(data.total), inline: true },
      { name: "Trạng Thái", value: data.start ? "🟢 Đang trực" : "🔴 Off", inline: true }
    )
    .setTimestamp();
}

async function updateMessage(interaction, member, data) {
  let channel = interaction.channel;

  if (data.messageId) {
    try {
      let msg = await channel.messages.fetch(data.messageId);
      await msg.edit({ embeds: [buildEmbed(member, data)] });
      return;
    } catch {}
  }

  let msg = await channel.send({ embeds: [buildEmbed(member, data)] });
  data.messageId = msg.id;
  data.channelId = channel.id;
}

// ===== PROMOTE =====
async function checkPromote(member, data) {
  if (data.total >= 60 * 3600 && member.roles.cache.has(ROLE_INTERN)) {
    await member.roles.remove(ROLE_INTERN);
    await member.roles.add(ROLE_EMPLOYEE);

    let ch = member.guild.channels.cache.get(PROMOTE_CHANNEL);
    if (ch) ch.send(`🎉 ${member} đã đủ 60h onduty và trở thành Culi Vip!`);
  }
}

// ===== COMMAND =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const data = getUser(member.guild.id, member.id);

  if (data.date !== today()) {
    data.today = 0;
    data.start = null;
    data.date = today();
  }

  if (interaction.commandName === "onduty") {

    if (!isPlayingGTA(member)) {
      return interaction.reply({
        content: "❌ Vào Game Đi ĐM",
        ephemeral: true
      });
    }

    if (data.start)
      return interaction.reply({ content: "Bạn đang onduty rồi!", ephemeral: true });

    let plate = interaction.options.getString("bienso");
    if (plate) data.plate = plate;

    data.start = now();

    await interaction.reply({ content: "✅ Bắt đầu onduty", ephemeral: true });
    await updateMessage(interaction, member, data);
    save();
  }

  if (interaction.commandName === "offduty") {
    if (!data.start)
      return interaction.reply({ content: "Bạn chưa onduty!", ephemeral: true });

    let diff = Math.floor((now() - new Date(data.start)) / 1000);
    data.today += diff;
    data.total += diff;
    data.start = null;

    await interaction.reply({ content: "⛔ Kết thúc onduty", ephemeral: true });
    await updateMessage(interaction, member, data);
    await checkPromote(member, data);
    save();
  }
});

// ===== READY =====
client.once("ready", () => console.log("Bot ready"));
client.login(TOKEN);

// ===== KEEP ALIVE =====
const app = express();
app.get("/", (req, res) => res.send("Bot alive"));
app.listen(3000);
