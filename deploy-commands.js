
const { REST, Routes, SlashCommandBuilder } = require("discord.js");
const TOKEN = process.env.TOKEN;

const TOKEN = "MTQ3MjE2MTkzNDYwOTc0NDEwNg.GKIbbm.eylpi9BfDyJVYRR7ErTOz-Xz9emZcUlrkHc08A";
const CLIENT_ID = "1472161934609744106";
const GUILD_ID = "1466476014908473550";

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
