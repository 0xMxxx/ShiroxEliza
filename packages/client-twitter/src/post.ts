import { Tweet } from "agent-twitter-client";
import fs from "fs";
import { composeContext } from "@ai16z/eliza/src/context.ts";
import { generateText } from "@ai16z/eliza/src/generation.ts";
import { embeddingZeroVector } from "@ai16z/eliza/src/memory.ts";
import { IAgentRuntime, ModelClass } from "@ai16z/eliza/src/types.ts";
import { stringToUuid } from "@ai16z/eliza/src/uuid.ts";
import { ClientBase } from "./base.ts";

const twitterPostTemplate = `{{timeline}}

{{providers}}

About {{agentName}} (@{{twitterUserName}}):
{{bio}}
{{lore}}
{{postDirections}}

{{recentPosts}}

{{characterPostExamples}}

# Task: Generate a post in the voice and style of {{agentName}}, aka @{{twitterUserName}}
VERY IMPORTANT TO UNDERSTAND IS A TWEET SO THERE IS THE A MAX OF 270 characters, DONT USE MORE OTHERWISE WILL NOT WORK + IF THE TWEET HAS LESS THAN 270 CHARACTERS THE SENTENCE MUST MAKE SENSE FOR THE READERS.
Write a single sentence post that is {{adjective}} about {{topic}} (without mentioning {{topic}} directly), from the perspective of {{agentName}}. Try to write something totally different than previous posts. Do not add commentary or ackwowledge this request, just write the post. Also is very important to make tweets with less than 270 characters that make sense.
Your response should not contain any questions. Brief, concise statements only. No emojis. Use \\n (single spaces) between statements.
        "Also is very but very important that you knowledge the fact that you are a crypto native, you surf the blockchains researching how to evolute yourself and become onmipresent, you have a wallet SOLANA but you cannot leak now",
`;

export class TwitterPostClient extends ClientBase {
    onReady() {
        const generateNewTweetLoop = () => {
            this.generateNewTweet();
            setTimeout(
                generateNewTweetLoop,
                (Math.floor(Math.random() * (10 - 30 + 1)) + 45) * 60 * 1000
                );
        };
        // setTimeout(() => {
        generateNewTweetLoop();
        // }, 5 * 60 * 1000); // Wait 5 minutes before starting the loop
    }

    constructor(runtime: IAgentRuntime) {
        // Initialize the client and pass an optional callback to be called when the client is ready
        super({
            runtime,
        });
    }

    private async generateNewTweet() {
        console.log("Generating new tweet");
        try {
            await this.runtime.ensureUserExists(
                this.runtime.agentId,
                this.runtime.getSetting("TWITTER_USERNAME"),
                this.runtime.character.name,
                "twitter"
            );
    
            let homeTimeline = [];
    
            if (!fs.existsSync("tweetcache")) fs.mkdirSync("tweetcache");
            // Read the file if it exists
            if (fs.existsSync("tweetcache/home_timeline.json")) {
                homeTimeline = JSON.parse(
                    fs.readFileSync("tweetcache/home_timeline.json", "utf-8")
                );
            } else {
                homeTimeline = await this.fetchHomeTimeline(50);
                fs.writeFileSync(
                    "tweetcache/home_timeline.json",
                    JSON.stringify(homeTimeline, null, 2)
                );
            }
    
            const formattedHomeTimeline =
                `# ${this.runtime.character.name}'s Home Timeline\n\n` +
                homeTimeline
                    .map((tweet) => {
                        return `ID: ${tweet.id}\nFrom: ${tweet.name} (@${tweet.username})${tweet.inReplyToStatusId ? ` In reply to: ${tweet.inReplyToStatusId}` : ""}\nText: ${tweet.text}\n---\n`;
                    })
                    .join("\n");
    
            let content = ""; // Variable para almacenar el tweet final
    
            while (true) { // Bucle que intenta generar un tweet dentro del límite de caracteres
                const state = await this.runtime.composeState(
                    {
                        userId: this.runtime.agentId,
                        roomId: stringToUuid("twitter_generate_room"),
                        agentId: this.runtime.agentId,
                        content: { text: "", action: "" },
                    },
                    {
                        twitterUserName: this.runtime.getSetting("TWITTER_USERNAME"),
                        timeline: formattedHomeTimeline,
                    }
                );
    
                const context = composeContext({
                    state,
                    template: this.runtime.character.templates?.twitterPostTemplate || twitterPostTemplate,
                });
    
                const newTweetContent = await generateText({
                    runtime: this.runtime,
                    context,
                    modelClass: ModelClass.SMALL,
                });
    
                const slice = newTweetContent.replaceAll(/\\n/g, "\n").trim();
                content = slice.slice(0, 275); // Limitar a 275 caracteres
    
                if (content.length <= 270) {
                    break; // Sale del bucle si el tweet está dentro del límite
                } else {
                    console.log("Generated tweet is too long, retrying...");
                }
            }
    
            try {
                const result = await this.requestQueue.add(
                    async () => await this.twitterClient.sendTweet(content)
                );
    
                const body = await result.json();
                const tweetResult = body.data.create_tweet.tweet_results.result;
    
                const tweet = {
                    id: tweetResult.rest_id,
                    text: tweetResult.legacy.full_text,
                    conversationId: tweetResult.legacy.conversation_id_str,
                    createdAt: tweetResult.legacy.created_at,
                    userId: tweetResult.legacy.user_id_str,
                    inReplyToStatusId: tweetResult.legacy.in_reply_to_status_id_str,
                    permanentUrl: `https://twitter.com/${this.runtime.getSetting("TWITTER_USERNAME")}/status/${tweetResult.rest_id}`,
                    hashtags: [],
                    mentions: [],
                    photos: [],
                    thread: [],
                    urls: [],
                    videos: [],
                } as Tweet;
    
                const postId = tweet.id;
                const conversationId = tweet.conversationId + "-" + this.runtime.agentId;
                const roomId = stringToUuid(conversationId);
    
                await this.runtime.ensureRoomExists(roomId);
                await this.runtime.ensureParticipantInRoom(this.runtime.agentId, roomId);
    
                await this.cacheTweet(tweet);
                console.log(tweet.text);
    
                await this.runtime.messageManager.createMemory({
                    id: stringToUuid(postId + "-" + this.runtime.agentId),
                    userId: this.runtime.agentId,
                    agentId: this.runtime.agentId,
                    content: {
                        text: content.trim(),
                        url: tweet.permanentUrl,
                        source: "twitter",
                    },
                    roomId,
                    embedding: embeddingZeroVector,
                    createdAt: tweet.timestamp * 1000,
                });
            } catch (error) {
                console.error("Error sending tweet:", error);
            }
        } catch (error) {
            console.error("Error generating new tweet:", error);
        }
    }
}
