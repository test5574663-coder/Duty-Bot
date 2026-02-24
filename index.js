const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActivityType
} = require("discord.js");
const fs = require("fs");
const express = require("express");

const TOKEN = process.env.TOKEN;

// ===== CONFIG =====
const TIMEZONE = "Asia/Ho_Chi_Minh";
const GAME_NAME = "GTA5VN";
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

function formatTime(d) {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(d));
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
      logs: [],
      messageId: null,
      channelId: null
    };
  }
  return db[guildId][userId];
}

function isPlayingGame(member) {
  if (!member.presence) return false;
  return member.presence.activities.some(
    a => a.type === ActivityType.Playing && a.name.includes(GAME_NAME)
  );
}

function buildEmbed(member, data) {
  let status = data.start ? "🟢 Đang trực" : "🔴 Off duty";
  let color = data.start ? 0x00ff00 : 0xff0000;

  let logText = data.logs.length
    ? data.logs.map(l => `• ${l}`).join("\n")
    : "Chưa có";

  if (data.start) {
    logText += `\n• ${formatTime(data.start)} → ...`;
  }

  return new EmbedBuilder()
    .setTitle("📋 BẢNG ONDUTY")
    .setColor(color)
    .addFields(
      { name: "Nhân sự", value: `<@${member.id}>` },
      { name: "Biển số", value: data.plate || "Chưa ghi" },
      { name: "Trạng thái", value: status },
      { name: "Ca trực", value: logText },
      { name: "Hôm nay", value: secondsToHMS(data.today) },
      { name: "Tổng", value: secondsToHMS(data.total) }
    )
    .setTimestamp();
}

async function updateMessage(interaction, member, data) {
  let channel =
    interaction.channel ||
    member.guild.channels.cache.get(data.channelId);

  if (!channel) return;

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

function closeDuty(member, data) {
  if (!data.start) return;

  let end = now();
  let diff = Math.floor((end - new Date(data.start)) / 1000);

  data.today += diff;
  data.total += diff;

  data.logs.push(`${formatTime(data.start)} → ${formatTime(end)}`);
  data.start = null;
}

client.on("presenceUpdate", async (oldP, newP) => {
  if (!newP.member) return;

  let member = newP.member;
  let data = getUser(member.guild.id, member.id);

  if (data.start && !isPlayingGame(member)) {
    closeDuty(member, data);
    save();

    let ch = member.guild.channels.cache.get(data.channelId);
    if (ch) {
      ch.send(`⛔ ${member} đã out game → tự off duty`);
      updateMessage({ channel: ch }, member, data);
    }
  }
});

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const data = getUser(member.guild.id, member.id);

  if (interaction.commandName === "onduty") {
    if (!isPlayingGame(member))
      return interaction.reply({
        content: "❌ Bạn chưa vào game!",
        ephemeral: true
      });

    if (data.start)
      return interaction.reply({
        content: "Bạn đang onduty rồi",
        ephemeral: true
      });

    let plate = interaction.options.getString("bienso");
    if (plate) data.plate = plate;

    data.start = now();

    await interaction.reply({
      content: "✅ Bắt đầu onduty",
      ephemeral: true
    });

    await updateMessage(interaction, member, data);
    save();
  }

  if (interaction.commandName === "offduty") {
    if (!data.start)
      return interaction.reply({
        content: "Bạn chưa onduty",
        ephemeral: true
      });

    closeDuty(member, data);

    await interaction.reply({
      content: "⛔ Off duty",
      ephemeral: true
    });

    await updateMessage(interaction, member, data);
    save();
  }

  if (interaction.commandName === "resetduty") {
    if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild))
      return interaction.reply({
        content: "Không có quyền",
        ephemeral: true
      });

    data.today = 0;
    data.total = 0;
    data.start = null;
    data.logs = [];

    await interaction.reply({
      content: "♻️ Reset duty",
      ephemeral: true
    });

    await updateMessage(interaction, member, data);
    save();
  }
});

client.once("ready", () => console.log("Bot ready"));
client.login(TOKEN);

// keep alive render
const app = express();
app.get("/", (req, res) => res.send("Bot alive"));
app.listen(3000);
