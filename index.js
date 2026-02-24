const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const express = require("express");

// ===== TOKEN =====
const TOKEN = process.env.TOKEN;

// ===== CONFIG =====
const ROLE_INTERN = "1467725396433834149";
const ROLE_EMPLOYEE = "1467724655766012129";
const PROMOTE_CHANNEL = "1472545636980101313";
const TIMEZONE = "Asia/Ho_Chi_Minh";

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// ===== KEEP ALIVE (Render) =====
const app = express();
app.get("/", (req, res) => res.send("Bot online"));
app.listen(3000);

// ===== DATABASE =====
let db = {};
if (fs.existsSync("data.json")) {
  db = JSON.parse(fs.readFileSync("data.json"));
}

function save() {
  fs.writeFileSync("data.json", JSON.stringify(db, null, 2));
}

function now() {
  return new Date();
}

function formatTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}h ${m}m`;
}

function todayStr() {
  return new Date().toLocaleDateString("vi-VN", { timeZone: TIMEZONE });
}

// ===== CHECK GTA5VN =====
function isPlayingGTA(member) {
  if (!member.presence || !member.presence.activities) return false;

  return member.presence.activities.some(a =>
    a.name && a.name.toLowerCase().includes("gta5vn")
  );
}

// ===== EMBED UPDATE =====
async function updateMessage(interaction, member, data) {
  const embed = new EmbedBuilder()
    .setColor("#00ff88")
    .setTitle("📋 BẢNG ONDUTY")
    .addFields(
      { name: "Tên Nhân Sự", value: `<@${member.id}>`, inline: true },
      { name: "Biển Số", value: data.plate || "Chưa ghi", inline: true },
      { name: "Ngày Onduty", value: data.date || todayStr(), inline: true },
      { name: "Thời Gian Onduty", value: formatTime(data.today || 0), inline: true },
      { name: "Tổng Thời Gian Onduty", value: formatTime(data.total || 0), inline: true },
      { name: "Trạng Thái", value: data.start ? "🟢 Đang trực" : "⚪ Off", inline: true }
    )
    .setFooter({ text: `Hôm nay lúc ${new Date().toLocaleTimeString("vi-VN")}` });

  if (!data.msgId) {
    const msg = await interaction.channel.send({ embeds: [embed] });
    data.msgId = msg.id;
  } else {
    try {
      const msg = await interaction.channel.messages.fetch(data.msgId);
      await msg.edit({ embeds: [embed] });
    } catch {
      const msg = await interaction.channel.send({ embeds: [embed] });
      data.msgId = msg.id;
    }
  }
}

// ===== PROMOTE CHECK =====
async function checkPromote(member, data) {
  if (data.total >= 60 * 3600 && member.roles.cache.has(ROLE_INTERN)) {
    await member.roles.remove(ROLE_INTERN);
    await member.roles.add(ROLE_EMPLOYEE);

    const ch = member.guild.channels.cache.get(PROMOTE_CHANNEL);
    if (ch) {
      ch.send(`🎉 <@${member.id}> đã đủ 60h và được lên Nhân Viên`);
    }
  }
}

// ===== INTERACTION =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  if (!db[member.id]) {
    db[member.id] = {
      total: 0,
      today: 0,
      start: null,
      plate: null,
      date: todayStr(),
      msgId: null
    };
  }

  const data = db[member.id];

  // ===== ONDUTY =====
  if (interaction.commandName === "onduty") {

    if (!isPlayingGTA(member)) {
      return interaction.reply({
        content: "❌ Bạn chưa vào GTA5VN!",
        ephemeral: true
      });
    }

    if (data.start) {
      return interaction.reply({
        content: "Bạn đang onduty rồi!",
        ephemeral: true
      });
    }

    const plate = interaction.options.getString("bienso");
    if (plate) data.plate = plate;

    data.start = now();
    data.date = todayStr();

    save();

    await interaction.reply({
      content: "✅ Bắt đầu onduty",
      ephemeral: true
    });

    await updateMessage(interaction, member, data);
  }

  // ===== OFFDUTY =====
  if (interaction.commandName === "offduty") {
    if (!data.start) {
      return interaction.reply({
        content: "Bạn chưa onduty!",
        ephemeral: true
      });
    }

    const diff = Math.floor((now() - new Date(data.start)) / 1000);
    data.today += diff;
    data.total += diff;
    data.start = null;

    save();

    await interaction.reply({
      content: "⛔ Kết thúc onduty",
      ephemeral: true
    });

    await updateMessage(interaction, member, data);
    await checkPromote(member, data);
  }

  // ===== RESET =====
if (interaction.commandName === "resetduty") {

  if (!member.roles.cache.some(r => RESET_ROLES.includes(1475698509523976273))) {
    return interaction.reply({
      content: "❌ Bạn không có quyền reset!",
      ephemeral: true
    });
  }

  data.today = 0;
  data.start = null;

  save();

  await interaction.reply({
    content: "Đã reset onduty",
    ephemeral: true
  });

  await updateMessage(interaction, member, data);
}

// ===== AUTO MIDNIGHT RESET =====
setInterval(() => {
  const current = todayStr();

  for (const id in db) {
    const d = db[id];
    if (d.date !== current) {
      if (d.start) {
        const diff = Math.floor((now() - new Date(d.start)) / 1000);
        d.today += diff;
        d.total += diff;
        d.start = null;
      }
      d.today = 0;
      d.date = current;
    }
  }

  save();
}, 60000);

// ===== LOGIN =====
client.login(TOKEN);
