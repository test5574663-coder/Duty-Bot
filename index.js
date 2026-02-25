const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

// ====== HTTP SERVER cho Render Web Service ======
const http = require("http");
http.createServer((req, res) => {
  res.write("Bot is running");
  res.end();
}).listen(process.env.PORT || 3000);

// ====== CONFIG ======
const TOKEN = process.env.TOKEN;
const GUILD_ID = "1466476014908473550";
const LOG_CHANNEL_ID = "1472440293940002828";

const ROLE_STAFF = "1475815959616032883";
const ROLE_TRAINEE = "1467725396433834149";

// ====== BOT ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const dutyData = new Map();

// ====== TIME FORMAT GMT+7 ======
function formatTime(date) {
  return new Date(date).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

// ====== ON DUTY ======
async function onDuty(member) {
  dutyData.set(member.id, {
    start: Date.now(),
  });
}

// ====== OFF DUTY ======
async function offDuty(member) {
  const data = dutyData.get(member.id);
  if (!data) return;

  const durationMs = Date.now() - data.start;
  const hours = durationMs / 3600000;

  const guild = client.guilds.cache.get(GUILD_ID);
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);

  const role = member.roles.cache.has(ROLE_TRAINEE)
    ? "Trainee"
    : "Staff";

  const embed = new EmbedBuilder()
    .setTitle("Duty Log")
    .addFields(
      { name: "User", value: `<@${member.id}>`, inline: true },
      { name: "Role", value: role, inline: true },
      { name: "Start", value: formatTime(data.start), inline: false },
      { name: "End", value: formatTime(Date.now()), inline: false },
      { name: "Total Hours", value: hours.toFixed(2) + "h", inline: false }
    )
    .setColor(role === "Trainee" ? 0x00ffff : 0x00ff00)
    .setTimestamp();

  logChannel.send({ embeds: [embed] });

  dutyData.delete(member.id);
}

// ====== SLASH COMMANDS ======
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;

  if (interaction.commandName === "onduty") {
    if (dutyData.has(member.id)) {
      return interaction.reply({
        content: "Bạn đã onduty rồi.",
        ephemeral: true,
      });
    }

    await onDuty(member);

    interaction.reply({
      content: "Đã onduty.",
      ephemeral: true,
    });
  }

  if (interaction.commandName === "offduty") {
    if (!dutyData.has(member.id)) {
      return interaction.reply({
        content: "Bạn chưa onduty.",
        ephemeral: true,
      });
    }

    await offDuty(member);

    interaction.reply({
      content: "Đã offduty.",
      ephemeral: true,
    });
  }
});

// ====== READY ======
client.once("ready", () => {
  console.log("Bot ready");
});

client.login(TOKEN);
