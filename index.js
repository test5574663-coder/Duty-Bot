require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require("discord.js");

const TOKEN = process.env.TOKEN;

const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";

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

// duty runtime
const duty = new Map();

// embed tracking (per day)
const dutyMsg = new Map();

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
  const today = formatDate(nowVN());

  // ===== ONDUTY =====
  if (i.commandName === "onduty") {
    const plate = i.options.getString("bienso");

    duty.set(member.id, {
      start: nowVN(),
      plate,
      lastGame: Date.now(),
      date: today
    });

    const data = duty.get(member.id);
    const embed = buildEmbed(member, data, "Đang trực");

    const old = dutyMsg.get(member.id);

    // nếu cùng ngày → edit
    if (old && old.date === today) {
      try {
        const ch = await client.channels.fetch(old.channelId);
        const msg = await ch.messages.fetch(old.messageId);
        await msg.edit({ embeds: [embed] });

        return i.reply({ content: "Đã cập nhật bảng onduty hôm nay", ephemeral: true });
      } catch {}
    }

    // tạo mới
    const msg = await i.reply({ embeds: [embed], fetchReply: true });

    dutyMsg.set(member.id, {
      messageId: msg.id,
      channelId: msg.channel.id,
      date: today
    });

    return;
  }

  // ===== OFFDUTY =====
  if (i.commandName === "ofduty") {
    const data = duty.get(member.id);
    if (!data) return i.reply({ content: "Bạn chưa onduty", ephemeral: true });

    duty.delete(member.id);

    const embed = buildEmbed(member, data, "Off");

    const old = dutyMsg.get(member.id);
    if (old) {
      try {
        const ch = await client.channels.fetch(old.channelId);
        const msg = await ch.messages.fetch(old.messageId);
        await msg.edit({ embeds: [embed] });
      } catch {}
    }

    return i.reply({ content: "Đã offduty", ephemeral: true });
  }

  // ===== RESET =====
  if (i.commandName === "resetduty") {
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.reply({ content: "Không có quyền", ephemeral: true });

    const user = i.options.getUser("user");

    duty.delete(user.id);
    dutyMsg.delete(user.id);

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

    const old = dutyMsg.get(id);
    if (old) {
      client.channels.fetch(old.channelId)
        .then(ch => ch.messages.fetch(old.messageId))
        .then(msg => msg.edit({ embeds: [embed] }))
        .catch(() => {});
    }
  }
});

// ===== LOGIN =====
client.login(TOKEN);
