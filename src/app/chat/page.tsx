"use client";

import { useState, useRef, useEffect } from "react";
import { Send, ArrowLeft, FileText, Bot, User } from "lucide-react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

interface Citation {
  id: string;
  documentName: string;
  pageNumber?: number;
  snippet: string;
  relevanceScore?: number;
}

interface ApiCitation {
  chunk_id: string;
  document_id: string;
  page_number: number;
  filename: string;
  score: number;
  chunk_text: string;
}

interface Message {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp?: Date;
  citations?: Citation[];
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "1",
      text: "Hello! I can help you analyze your uploaded documents with detailed citations. Ask me about summaries, specific topics, or any questions about your files. I'll provide responses with references to the exact sources.",
      sender: "bot",
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [hoveredCitation, setHoveredCitation] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: inputText,
      sender: "user",
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const query = inputText;
    setInputText("");
    setIsTyping(true);

    try {
      const response = await fetch("http://127.0.0.1:8000/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query,
          top_k: 5,
        }),
      });

      if (!response.ok) {
        console.error("API error:", response.status, response.statusText);
        const errorText = await response.text();
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `Sorry, I encountered an error. ${errorText}`,
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, botMessage]);
        setIsTyping(false);
        return;
      }

      if (!response.body) {
        throw new Error("The response body is empty.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const botMessageId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        {
          id: botMessageId,
          text: "",
          sender: "bot",
          citations: [],
        },
      ]);

      let responseText = "";
      let citations: Citation[] = [];

      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === botMessageId
                ? { ...msg, timestamp: new Date() }
                : msg
            )
          );
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");

        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim() === "") continue;
          try {
            const json = JSON.parse(line);
            if (json.data) {
              if (typeof json.data === "string") {
                responseText += json.data;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === botMessageId
                      ? { ...msg, text: responseText }
                      : msg
                  )
                );
              } else if (Array.isArray(json.data)) {
                citations = json.data.map(
                  (c: ApiCitation): Citation => ({
                    id: c.chunk_id,
                    documentName: c.filename,
                    pageNumber: c.page_number,
                    snippet: c.chunk_text,
                    relevanceScore: c.score,
                  })
                );
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === botMessageId
                      ? { ...msg, citations: citations }
                      : msg
                  )
                );
              }
            }
          } catch (e) {
            console.error("Error parsing JSON line:", line);
          }
        }
      }
    } catch (error) {
      console.error("Failed to fetch from the API:", error);
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "Sorry, I am unable to connect to the server. Please check if the server is running and try again.",
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="h-screen bg-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b flex-shrink-0">
        <div className="px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 sm:space-x-4">
              <Link
                href="/"
                className="flex items-center space-x-2 text-gray-600 hover:text-blue-600 transition-colors"
              >
                <ArrowLeft className="w-4 h-4 sm:w-5 sm:h-5" />
                <span className="hidden sm:inline">Back to Upload</span>
                <span className="sm:hidden">Back</span>
              </Link>
              <div className="w-px h-4 sm:h-6 bg-gray-300"></div>
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                <h1 className="text-lg sm:text-xl font-semibold text-gray-800">
                  Document Chat
                </h1>
              </div>
            </div>
            <div className="hidden sm:flex items-center space-x-2 text-sm text-gray-500">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>AI Assistant Online</span>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Container */}
      <div className="flex-1 flex flex-col min-h-0 max-w-3xl w-full mx-auto">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 space-y-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className={`flex items-start space-x-2 max-w-[90%] sm:max-w-[80%] ${
                  message.sender === "user"
                    ? "flex-row-reverse space-x-reverse"
                    : ""
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    message.sender === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {message.sender === "user" ? (
                    <User className="w-4 h-4" />
                  ) : (
                    <Bot className="w-4 h-4" />
                  )}
                </div>

                <div
                  className={`rounded-lg px-4 py-2 ${
                    message.sender === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  <div className="text-sm leading-relaxed prose">
                    {message.sender === "bot" ? (
                      <ReactMarkdown
                        rehypePlugins={[rehypeRaw]}
                        components={{
                          sup: ({ node, ...props }) => {
                            let textContent = "";
                            let instance = "";

                            if (node && node.children) {
                              node.children.forEach((child) => {
                                if ("value" in child) {
                                  if (child.type === "text") {
                                    textContent += child.value;
                                  } else if (child.type === "comment") {
                                    instance += child.value;
                                  }
                                }
                              });
                            }

                            const citationMatch =
                              textContent.match(/\[(\d+)\]/);
                            if (citationMatch) {
                              const citationNumber = parseInt(
                                citationMatch[1],
                                10
                              );
                              const citation =
                                message.citations?.[citationNumber - 1];

                              if (citation) {
                                const hoverKey = `${message.id}-${citation.id}-${citationNumber}-${instance}`;
                                return (
                                  <span
                                    className="relative inline-block"
                                    onMouseEnter={() =>
                                      setHoveredCitation(hoverKey)
                                    }
                                    onMouseLeave={() =>
                                      setHoveredCitation(null)
                                    }
                                  >
                                    <sup className="text-blue-600 bg-blue-100 hover:bg-blue-200 px-1 py-0.5 rounded text-xs font-medium cursor-pointer transition-colors">
                                      {citationNumber}
                                    </sup>
                                    {hoveredCitation === hoverKey && (
                                      <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-72 sm:w-80 bg-black text-white text-xs rounded-lg p-3 shadow-lg z-50 block max-w-[90vw]">
                                        <span className="flex items-center space-x-2 mb-2">
                                          <FileText className="w-3 h-3" />
                                          <span className="font-medium truncate">
                                            {citation.documentName}
                                          </span>
                                          {citation.pageNumber && (
                                            <span className="text-gray-300 flex-shrink-0">
                                              Page {citation.pageNumber}
                                            </span>
                                          )}
                                        </span>
                                        <span className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-black block"></span>
                                      </span>
                                    )}
                                  </span>
                                );
                              }
                            }
                            return <sup {...props}>{textContent}</sup>;
                          },
                        }}
                      >
                        {(() => {
                          let i = 0;
                          return message.text.replace(/\[(\d+)\]/g, (match) => {
                            i++;
                            return `<sup>${match}<!--${i}--></sup>`;
                          });
                        })()}
                      </ReactMarkdown>
                    ) : (
                      <p>{message.text}</p>
                    )}
                  </div>
                  {message.sender === "bot" &&
                    message.citations &&
                    message.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-gray-200 max-w-2xl">
                        <div className="flex flex-row w-full justify-start gap-2 max-w-2xl overflow-x-auto">
                          {message.citations.map((citation, index) => (
                            <div
                              key={citation.id}
                              className="bg-white/70 p-2 rounded-md text-xs"
                            >
                              <div className="flex items-center space-x-2">
                                <FileText className="w-3 h-3 flex-shrink-0 text-gray-500" />
                                <span className="font-medium text-gray-700 truncate">
                                  {`${citation.documentName}`}
                                </span>
                              </div>
                              {citation.pageNumber && (
                                <div className="pl-5 mt-0.5 text-gray-500">
                                  Page: {citation.pageNumber}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  {message.timestamp && (
                    <p
                      className={`text-xs mt-1 ${
                        message.sender === "user"
                          ? "text-blue-100"
                          : "text-gray-500"
                      }`}
                    >
                      {formatTime(message.timestamp)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing Indicator */}
          {isTyping && (
            <div className="flex justify-start">
              <div className="flex items-start space-x-2 max-w-[80%]">
                <div className="w-8 h-8 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-gray-100 rounded-lg px-4 py-2">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.1s" }}
                    ></div>
                    <div
                      className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                      style={{ animationDelay: "0.2s" }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 sm:p-6 bg-neutral-100 flex-shrink-0 rounded-t-lg">
          <div className="flex space-x-2 sm:space-x-4">
            <div className="flex-1 relative">
              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Ask me anything about your documents..."
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 sm:px-4 sm:py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-500 text-black text-sm sm:text-base"
                rows={1}
                style={{ minHeight: "44px", maxHeight: "120px" }}
              />
            </div>
            <button
              onClick={handleSendMessage}
              disabled={!inputText.trim() || isTyping}
              className="bg-blue-600 text-white rounded-lg px-4 py-2 sm:px-6 sm:py-3 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-1 sm:space-x-2 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </div>

          <div className="mt-2 text-xs text-gray-500">
            Press Enter to send, Shift+Enter for new line
          </div>
        </div>
      </div>
    </div>
  );
}
