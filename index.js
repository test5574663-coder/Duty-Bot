const fs = require("fs");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField
} = require("discord.js");

const TOKEN = process.env.TOKEN;

// ===== CONFIG =====
const TIMEZONE = "Asia/Ho_Chi_Minh";
const GAME_NAMES = ["GTA5VN", "FiveM"]; // tên game hợp lệ
const ADMIN_ROLES = ["1475815959616032883"]; // role có quyền reset/forceoff
// ==================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

let db = {};
if (fs.existsSync("data.json")) db = JSON.parse(fs.readFileSync("data.json"));

function save() {
  fs.writeFileSync("data.json", JSON.stringify(db, null, 2));
}

function now() {
  return new Date();
}

function today() {
  return new Date().toLocaleDateString("vi-VN", { timeZone: TIMEZONE });
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
      sessions: [],
      messageId: null,
      channelId: null
    };
  }
  return db[guildId][userId];
}

function isInGame(member) {
  if (!member.presence || !member.presence.activities) return false;
  return member.presence.activities.some(a =>
    GAME_NAMES.includes(a.name)
  );
}

function buildEmbed(member, data) {
  let color = data.start ? 0x00ff00 : 0xff0000;
  let status = data.start ? "🟢 Đang trực" : "🔴 Đã off";

  let sessionText =
    data.sessions.length === 0
      ? "Chưa có"
      : data.sessions
          .map(s => `• ${s.start} → ${s.end}`)
          .join("\n");

  if (data.start) {
    sessionText += `\n• ${formatTime(data.start)} → ...`;
  }

  return new EmbedBuilder()
    .setTitle("📋 BẢNG ONDUTY")
    .setColor(color)
    .addFields(
      { name: "👤 Nhân sự", value: `<@${member.id}>` },
      { name: "🚗 Biển số", value: data.plate || "Chưa ghi" },
      { name: "📅 Ngày", value: data.date },
      { name: "⏱️ Hôm nay", value: secondsToHMS(data.today) },
      { name: "📊 Tổng", value: secondsToHMS(data.total) },
      { name: "📍 Trạng thái", value: status },
      { name: "🕒 Ca trực", value: sessionText }
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

function finishDuty(member, data) {
  if (!data.start) return;

  let diff = Math.floor((now() - new Date(data.start)) / 1000);
  data.today += diff;
  data.total += diff;

  data.sessions.push({
    start: formatTime(data.start),
    end: formatTime(now())
  });

  data.start = null;
}

// ===== COMMANDS =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const data = getUser(member.guild.id, member.id);

  if (data.date !== today()) {
    data.today = 0;
    data.start = null;
    data.sessions = [];
    data.date = today();
  }

  // ONDUTY
  if (interaction.commandName === "onduty") {
    if (!isInGame(member))
      return interaction.reply({
        content: "❌ Bạn chưa vào game!",
        ephemeral: true
      });

    if (data.start)
      return interaction.reply({
        content: "Bạn đang onduty rồi!",
        ephemeral: true
      });

    let plate = interaction.options.getString("bienso");
    data.plate = plate || data.plate;
    data.start = now();

    await interaction.reply({ content: "🟢 Bắt đầu onduty", ephemeral: true });
    await updateMessage(interaction, member, data);
    save();
  }

  // OFFDUTY
  if (interaction.commandName === "offduty") {
    if (!data.start)
      return interaction.reply({
        content: "Bạn chưa onduty!",
        ephemeral: true
      });

    finishDuty(member, data);

    await interaction.reply({ content: "🔴 Đã offduty", ephemeral: true });
    await updateMessage(interaction, member, data);
    save();
  }

  // RESET
  if (interaction.commandName === "resetduty") {
    if (
      !member.roles.cache.some(r => ADMIN_ROLES.includes(r.id)) &&
      !member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    )
      return interaction.reply({
        content: "Không có quyền!",
        ephemeral: true
      });

    data.total = 0;
    data.today = 0;
    data.start = null;
    data.sessions = [];

    await interaction.reply({ content: "♻️ Đã reset duty", ephemeral: true });
    await updateMessage(interaction, member, data);
    save();
  }

  // FORCE OFF
  if (interaction.commandName === "forceoff") {
    if (
      !member.roles.cache.some(r => ADMIN_ROLES.includes(r.id)) &&
      !member.permissions.has(PermissionsBitField.Flags.ManageGuild)
    )
      return interaction.reply({
        content: "Không có quyền!",
        ephemeral: true
      });

    let target = interaction.options.getUser("user");
    let tData = getUser(member.guild.id, target.id);

    finishDuty(member, tData);

    await interaction.reply({
      content: `Đã offduty ${target}`,
      ephemeral: true
    });

    save();
  }
});

// ===== AUTO OFF KHI OUT GAME =====
client.on("presenceUpdate", (oldP, newP) => {
  if (!newP || !newP.member) return;

  const member = newP.member;
  const data = getUser(member.guild.id, member.id);

  if (data.start && !isInGame(member)) {
    finishDuty(member, data);
    save();
  }
});

client.once("ready", () => console.log("Bot ready"));
client.login(TOKEN);

// keep alive render
const app = express();
app.get("/", (req, res) => res.send("Bot alive"));
app.listen(3000);
