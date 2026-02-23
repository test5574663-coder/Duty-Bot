
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField } = require("discord.js");
const fs = require("fs");
const express = require("express");

const TOKEN = process.env.TOKEN;

// ====== CONFIG ======
const ROLE_INTERN = "ROLE_THUCTAP_ID";
const ROLE_EMPLOYEE = "ROLE_NHANVIEN_ID";
const PROMOTE_CHANNEL = "KENH_THANGCAP_ID";
const TIMEZONE = "Asia/Ho_Chi_Minh";
// ====================

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

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
      { name: "Trạng Thái Hoạt Động", value: data.start ? "🟢 Đang trực" : "🔴 Đã off", inline: true }
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

async function checkPromote(member, data) {
  if (data.total >= 60 * 3600 && member.roles.cache.has(ROLE_INTERN)) {
    await member.roles.remove(ROLE_INTERN);
    await member.roles.add(ROLE_EMPLOYEE);

    let ch = member.guild.channels.cache.get(PROMOTE_CHANNEL);
    if (ch) {
      ch.send(`🎉 ${member} đã đủ 60h onduty và được thăng cấp Nhân viên!`);
    }
  }
}

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const data = getUser(member.guild.id, member.id);

  // reset sang ngày mới
  if (data.date !== today()) {
    data.today = 0;
    data.start = null;
    data.date = today();
  }

  if (interaction.commandName === "onduty") {
    if (data.start) return interaction.reply({ content: "Bạn đang onduty rồi!", ephemeral: true });

    let plate = interaction.options.getString("bienso");
    data.plate = plate || data.plate;
    data.start = now();

    await interaction.reply({ content: "✅ Bắt đầu onduty", ephemeral: true });
    await updateMessage(interaction, member, data);
    save();
  }

  if (interaction.commandName === "offduty") {
    if (!data.start) return interaction.reply({ content: "Bạn chưa onduty!", ephemeral: true });

    let diff = Math.floor((now() - new Date(data.start)) / 1000);
    data.today += diff;
    data.total += diff;
    data.start = null;

    await interaction.reply({ content: "⛔ Kết thúc onduty", ephemeral: true });
    await updateMessage(interaction, member, data);
    await checkPromote(member, data);
    save();
  }

  if (interaction.commandName === "resetduty") {
    if (!member.permissions.has(PermissionsBitField.Flags.ManageGuild))
      return interaction.reply({ content: "Không có quyền!", ephemeral: true });

    data.today = 0;
    data.start = null;

    await interaction.reply({ content: "♻️ Đã reset duty", ephemeral: true });
    await updateMessage(interaction, member, data);
    save();
  }
});

// auto đóng ca 23:59 GMT+7
setInterval(() => {
  let t = new Date().toLocaleTimeString("vi-VN", { timeZone: TIMEZONE });
  if (t.startsWith("23:59")) {
    for (let g in db) {
      for (let u in db[g]) {
        let d = db[g][u];
        if (d.start) {
          let diff = Math.floor((now() - new Date(d.start)) / 1000);
          d.today += diff;
          d.total += diff;
          d.start = null;
        }
      }
    }
    save();
  }
}, 60000);

client.once("ready", () => console.log("Bot ready"));
client.login(TOKEN);

// keep alive render
const app = express();
app.get("/", (req, res) => res.send("Bot alive"));
app.listen(3000);
