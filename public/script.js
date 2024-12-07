document.addEventListener("DOMContentLoaded", () => {
    if (!document.cookie.split('; ').find(row => row.startsWith('jwtPayload='))) {
        window.location.href = '/login';
        return;
    }
    const conversationsList = document.getElementById("conversations-list");
    const chatHistory = document.getElementById("chat-history");
    const chatInput = document.getElementById("chat-input");
    const sendButton = document.getElementById("send-button");
    chatInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            sendButton.click();
        }
    });
    const newConversationButton = document.getElementById("new-conversation-button");
    const chatContainer = document.querySelector(".chat-container");
    const startNewConversationLink = document.createElement("a");
    startNewConversationLink.id = "start-new-conversation-link";
    startNewConversationLink.href = "#";
    startNewConversationLink.textContent = "Start a new Conversation";
    startNewConversationLink.style.color = "#f6821f";
    startNewConversationLink.style.cursor = "pointer";
    chatContainer.style.display = "none";
    startNewConversationLink.style.display = "flex";
    startNewConversationLink.style.justifyContent = "center";
    startNewConversationLink.style.textAlign = "center";
    startNewConversationLink.style.alignItems = "center";
    startNewConversationLink.style.height = "100%";
    chatContainer.parentNode.insertBefore(startNewConversationLink, chatContainer);

    let currentConversationId = null;

    async function loadConversations() {
        try {
            const response = await fetch("/api/conversations");
            const data = await response.json();
            const conversations = data.results;
            conversationsList.innerHTML = "";
            conversations.forEach((conversation) => {
                const item = document.createElement("div");
                item.classList.add("conversation-item");
                item.textContent = conversation.title;
                item.dataset.conversationId = conversation.id;
                item.addEventListener("click", () => loadConversation(conversation.id));
                conversationsList.appendChild(item);
            });
        } catch (error) {
            console.error("Error loading conversations: ", error);
        }
    }

    async function loadConversation(conversationId) {
        currentConversationId = conversationId;
        try {
            const response = await fetch(`/api/conversations/${currentConversationId}/messages`);
            const data = await response.json();
            const messages = data.results;
            chatHistory.innerHTML = "";
            messages.forEach((message) => {
                const messageElement = document.createElement("div");
                messageElement.classList.add("chat-message", message.role);
                messageElement.textContent = message.content;
                chatHistory.appendChild(messageElement);
            });
            chatHistory.scrollTop = chatHistory.scrollHeight;

            // Highlight active conversation
            document.querySelectorAll(".conversation-item").forEach(item => {
                item.classList.remove("active-conversation");
                item.style.backgroundColor = "";
                item.style.color = "";
            });
            const activeConversationItem = document.querySelector(`[data-conversation-id="${conversationId}"]`);
            if (activeConversationItem) {
                activeConversationItem.classList.add("active-conversation");
                activeConversationItem.style.backgroundColor = "#f6821f";
                activeConversationItem.style.color = "#000000";
            }

            // Show chat interface and hide the link
            chatContainer.style.display = "flex";
            startNewConversationLink.style.display = "none";
        } catch (error) {
            console.error("Error loading conversation: ", error);
        }
    }

    sendButton.addEventListener("click", async () => {
        const messageContent = chatInput.value.trim();
        if (messageContent && currentConversationId) {
            const userMessageElement = document.createElement("div");
            userMessageElement.classList.add("chat-message", "user");
            userMessageElement.textContent = messageContent;
            chatHistory.appendChild(userMessageElement);
            chatHistory.scrollTop = chatHistory.scrollHeight;

            chatInput.value = "";
            try {
                const response = await fetch(`/api/conversations/${currentConversationId}/messages`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ role: "user", content: messageContent }),
                });

                const assistantMessageElement = document.createElement("div");
                assistantMessageElement.classList.add("chat-message", "assistant");
                chatHistory.appendChild(assistantMessageElement);
                chatHistory.scrollTop = chatHistory.scrollHeight;

                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");
                let done = false;
                while (!done) {
                    const { value, done: readerDone } = await reader.read();
                    done = readerDone;
                    if (value) {
                        const chunk = decoder.decode(value);
                        assistantMessageElement.textContent += chunk;
                        chatHistory.scrollTop = chatHistory.scrollHeight;
                    }
                }
            } catch (error) {
                console.error("Error sending message: ", error);
            }
        }
    });

    newConversationButton.addEventListener("click", async () => {
        await createNewConversation();
    });

    startNewConversationLink.addEventListener("click", async (event) => {
        event.preventDefault();
        await createNewConversation();
    });

    async function createNewConversation() {
        try {
            const response = await fetch("/api/conversations", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({})
            });
            const newConversation = await response.json();
            loadConversation(newConversation.id);
            loadConversations();
        } catch (error) {
            console.error("Error creating new conversation: ", error);
        }
    }

    loadConversations();
});
