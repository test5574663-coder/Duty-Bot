require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require("discord.js");

const TOKEN = process.env.TOKEN;

const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";
const STAFF_ROLE_ID = "1467724655766012129";

const PORT = process.env.PORT || 3000;

// ===== WEB SERVICE KEEP ALIVE =====
require("http").createServer((req, res) => res.end("OK")).listen(PORT);

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

const duty = new Map();

// ===== TIME VN =====
function nowVN() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}

function formatTime(d) {
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}

function formatDate(d) {
  return d.toLocaleDateString("vi-VN");
}

function diffText(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} giờ ${m} phút`;
}

// ===== EMBED =====
function buildEmbed(member, data, status) {
  const now = nowVN();
  const total = now - data.start;

  return new EmbedBuilder()
    .setColor("#00ff9c")
    .setAuthor({ name: "BẢNG ONDUTY" })
    .setDescription(
`**Tên Nhân Sự :** ${member}

**Biển Số :** ${data.plate || "Chưa nhập"}

**Thời Gian Onduty :** ${formatTime(data.start)} ➝ ${status === "Đang trực" ? "..." : formatTime(now)}

**Ngày Onduty :** ${formatDate(data.start)}

**Tổng Thời Gian Onduty :** ${diffText(total)}

**Trạng Thái Hoạt Động :** ${status}`
    );
}

// ===== SLASH =====
const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o =>
      o.setName("bienso")
       .setDescription("Nhập biển số xe")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ofduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("resetduty")
    .setDescription("Reset duty")
    .addUserOption(o =>
      o.setName("user")
       .setDescription("Chọn người")
       .setRequired(true)
    )
].map(c => c.toJSON());

client.once("clientReady", async () => {
  console.log("Bot ready");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

// ===== ONDUTY =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const member = i.member;

  if (i.commandName === "onduty") {
    const plate = i.options.getString("bienso");

    duty.set(member.id, {
      start: nowVN(),
      plate,
      lastGame: Date.now()
    });

    const embed = buildEmbed(member, duty.get(member.id), "Đang trực");

    return i.reply({ embeds: [embed] });
  }

  if (i.commandName === "ofduty") {
    const data = duty.get(member.id);
    if (!data) return i.reply({ content: "Bạn chưa onduty", ephemeral: true });

    duty.delete(member.id);

    const embed = buildEmbed(member, data, "Off ");
    return i.reply({ embeds: [embed] });
  }

  if (i.commandName === "resetduty") {
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.reply({ content: "Không có quyền", ephemeral: true });

    const user = i.options.getUser("user");
    duty.delete(user.id);

    return i.reply(`Đã reset duty ${user}`);
  }
});

// ===== PRESENCE WATCH =====
client.on("presenceUpdate", (oldP, newP) => {
  if (!newP) return;

  const id = newP.userId;
  const data = duty.get(id);
  if (!data) return;

  const playing = newP.activities?.some(a =>
    a.name?.toLowerCase().includes("gta")
  );

  if (playing) {
    data.lastGame = Date.now();
    return;
  }

  if (Date.now() - data.lastGame > 10 * 60 * 1000) {
    duty.delete(id);
    const member = `<@${id}>`;
    const embed = buildEmbed(member, data, "Tự off (idle game)");
    const ch = newP.guild.systemChannel;
    if (ch) ch.send({ embeds: [embed] });
  }
});

// ===== LOGIN =====
client.login(TOKEN);
