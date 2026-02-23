
const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = "BOT_TOKEN";
const CLIENT_ID = "BOT_CLIENT_ID";
const GUILD_ID = "SERVER_ID";

const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o =>
      o.setName("bienso")
        .setDescription("Biển số")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("offduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("resetduty")
    .setDescription("Reset giờ trực")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);
rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
