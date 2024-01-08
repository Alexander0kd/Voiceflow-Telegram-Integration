const { Telegraf } = require('telegraf')
const axios = require('axios');

require('dotenv').config();

const bot = new Telegraf(process.env.TELEGRAM_TOKEN)

async function interact(ctx, chatID, request) {
    let response = null;

    await ctx.persistentChatAction("typing", async () => {
        response = await axios({
            method: 'POST',
            url: `https://general-runtime.voiceflow.com/state/user/${chatID}/interact`,
            headers: {
                Authorization: process.env.VOICEFLOW_API_KEY
            },
            data: {
                request
            }
        });
    })

    for (const trace of response.data) {          
        switch(trace.type) {
            case "text":
            case "speak": {
                await ctx.reply(trace.payload.message, { parse_mode: 'markdown' });
                break;
            }
            case "visual": {
                await ctx.replyWithPhoto({ url: trace.payload.imageUrl });
                break;
            }
            case "cardV2": {
                await proceedCard(chatID, ctx, trace.payload);
                break;
            }
            case "carousel": {
                await proceedCarousel(chatID, ctx, trace.payload.cards);
                break;
            }
            case "choice": {
                await proceedButtons(chatID, ctx, trace.payload.buttons);
                break;
            }
            case "no-reply":
            case "end": {
                await ctx.reply("Conversation is over", { parse_mode: 'markdown' });
                break;
            }
        }
    }

}

async function proceedButtons(chatID, ctx, buttons) {
    if (buttons.length <= 0) return;

    const inlineKeyboard = buttons.map(button => ([{
        text: button.name,
        callback_data: `${chatID}|${button.request.type}`
    }]));
    
    await ctx.reply("Make Choice:", { reply_markup: { inline_keyboard: inlineKeyboard }, parse_mode: 'markdown' });
    
    for (const button of buttons) {
        bot.action(
            `${chatID}|${button.request.type}`,
            async (ctx) =>
        {
            await ctx.editMessageText(`Your choice: *${button.name}*`, { parse_mode: 'markdown' });                        
            await interact(ctx, chatID, { type:  button.request.type });
        });
    }
}

async function proceedCarousel(chatID, ctx, carousel) {
    const buttonStamp = Date.now();
    let carouselMessages = [];

    for (const card of carousel) {
        let inlineKeyboard = [];
        
        if (card.buttons.length > 0) {
            inlineKeyboard = card.buttons.map(button => ([{
                text: button.name,
                callback_data: `${chatID}|${buttonStamp}|${button.request.type}`
            }]));    
        }
        
        const { message_id } = await ctx.replyWithPhoto(
            { url: card.imageUrl },
            {
                caption: `${proceedTitle(card.title)}\n${proceedDescription(card.description.slate)}`,
                parse_mode: 'markdown',
                reply_markup: { inline_keyboard: inlineKeyboard }
            }
        );

        if (card.buttons.length <= 0) continue;

        carouselMessages.push(message_id);
        for (const button of card.buttons) {
            bot.action(
                `${chatID}|${buttonStamp}|${button.request.type}`,
                async (ctx) =>
            {
                for (const cId of carouselMessages) {
                    await ctx.telegram.editMessageReplyMarkup(
                        chatID,
                        cId,
                        undefined,
                        { inline_keyboard: [] }
                    );
                }

                await interact(ctx, chatID, { type:  button.request.type });
            });
        }
    }
}

async function proceedCard(chatID, ctx, card) {
    const buttonStamp = Date.now();
    let inlineKeyboard = [];

    if (
        card.buttons &&
        card.buttons.length > 0
    ) {
        inlineKeyboard = card.buttons.map(button => ([{
            text: button.name,
            callback_data: `${chatID}|${buttonStamp}|${button.request.type}`
        }]));
    }

    const { message_id } = await ctx.replyWithPhoto(
        { url: card.imageUrl },
        {
            caption: `${proceedTitle(card.title)}\n${proceedDescription(card.description.slate)}`,
            parse_mode: 'markdown',
            reply_markup: { inline_keyboard: inlineKeyboard }
        });

    for (const button of card.buttons) {
        bot.action(
            `${chatID}|${buttonStamp}|${button.request.type}`,
            async (ctx) =>
        {

            await ctx.telegram.editMessageReplyMarkup(
                chatID,
                message_id,
                undefined,
                { inline_keyboard: [] }
            );

            await interact(ctx, chatID, { type:  button.request.type });
        });
    }
}

function proceedTitle(title) {
    if (title.length > 0) {
        return `*${title}*`;
    }
    return '';
}

function proceedDescription(slate) {
    if (slate.length <= 0) return;

    let msg = '';
    for (const part of slate) {
        for (const txt of part.children) {
            if (txt.underline) {
                txt.text = `__${txt.text}__`;
            }
            if (txt.fontWeight) {
                txt.text = `*${txt.text}*`;
            }
            if (txt.strikeThrough) {
                txt.text = `~${txt.text}~`;
            }
            if (txt.italic) {
                txt.text = `_${txt.text}_`;
            }
            msg += txt.text;
        }
    }
    return msg;
}

bot.start(async(ctx) => {
    let chatID = ctx.message.chat.id;
    await interact(ctx, chatID, { type: 'launch' });
});

const ANY_WORD_REGEX = new RegExp(/(.*)/i);
bot.hears(ANY_WORD_REGEX, async(ctx) => {
    let chatID = ctx.message.chat.id;
    await interact(ctx, chatID, { type: 'text', payload: ctx.message.text });
});

console.log('---------------[BOT STARTED]-----------------');
bot.launch();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));