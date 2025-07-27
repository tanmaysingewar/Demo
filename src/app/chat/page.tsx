"use client";

import { useState, useRef, useEffect } from "react";
import {
  Send,
  ArrowLeft,
  FileText,
  Bot,
  User,
  Mic,
  StopCircle,
  Globe,
  Search,
} from "lucide-react";
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

interface SearchResult {
  type: "docs" | "web";
  text: string;
  citations: Citation[];
  messageId?: string;
  error?: boolean;
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
      text: "Hello! I can help you analyze your uploaded documents with detailed citations or search the web for information. Use the switches in the header to enable document search, web search, or both simultaneously.",
      sender: "bot",
      timestamp: new Date(),
    },
  ]);
  const [inputText, setInputText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [searchModes, setSearchModes] = useState({
    docs: true,
    web: false,
  });
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
    null
  );
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [hoveredCitation, setHoveredCitation] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>("");

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    // Check if at least one search mode is enabled
    if (!searchModes.docs && !searchModes.web) {
      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: "Please enable at least one search mode (Docs or Web) to ask questions.",
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
      return;
    }

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
      // Single API call with search modes
      const response = await fetch("http://127.0.0.1:8000/query", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: query,
          top_k: 5,
          search_docs: searchModes.docs,
          search_web: searchModes.web,
        }),
      });

      if (response.ok && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let responseText = "";
        let citations: Citation[] = [];

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

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

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
                  // Update message in real-time
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === botMessageId
                        ? {
                            ...msg,
                            text: responseText,
                          }
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
                }
              }
            } catch (e) {
              console.error("Error parsing JSON line:", line);
            }
          }
        }

        // Update final message with citations and timestamp
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === botMessageId
              ? {
                  ...msg,
                  text: responseText,
                  citations: citations,
                  timestamp: new Date(),
                }
              : msg
          )
        );
      } else {
        const errorMessage = await response.text();
        const botMessage: Message = {
          id: (Date.now() + 1).toString(),
          text: `Error: ${
            errorMessage || "Failed to get response from server"
          }`,
          sender: "bot",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, botMessage]);
      }
    } catch (error) {
      console.error("Search error:", error);
      const enabledModes = Object.entries(searchModes)
        .filter(([_, enabled]) => enabled)
        .map(([mode, _]) => mode)
        .join(" & ");

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: `Sorry, I am unable to connect to the server. Please check if the server is running and try again. (${enabledModes} search)`,
        sender: "bot",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, botMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isRecording) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const startRecording = async () => {
    if (isRecording) return;
    setInputText(""); // Clear previous text

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });
      setMediaRecorder(recorder);
      setIsRecording(true);

      const ws = new WebSocket("ws://127.0.0.1:8000/listen");
      setWebsocket(ws);

      ws.onopen = () => {
        console.log("WebSocket connected for audio streaming");
        recorder.start(250);
      };

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      let finalTranscript = "";
      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        const transcript = data.transcript;

        if (transcript) {
          if (data.is_final) {
            finalTranscript += transcript + " ";
            setInputText(finalTranscript);
          } else {
            setInputText(finalTranscript + transcript);
          }
        }
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setIsRecording(false);
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setIsRecording(false);
      };
    } catch (error) {
      console.error("Error accessing microphone:", error);
      setIsRecording(false);
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    setIsRecording(false);

    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      setMediaRecorder(null);
    }
    if (websocket) {
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
      setWebsocket(null);
    }

    // After stopping, send the content of the text box.
    if (inputText.trim()) {
      handleSendMessage();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const getActiveModes = () => {
    const modes = [];
    if (searchModes.docs) modes.push("documents");
    if (searchModes.web) modes.push("web");
    return modes.join(" and ");
  };

  const getPlaceholderText = () => {
    if (searchModes.docs && searchModes.web) {
      return "Ask me anything about your documents or from the web...";
    } else if (searchModes.docs) {
      return "Ask me anything about your documents...";
    } else if (searchModes.web) {
      return "Ask me anything from the web...";
    } else {
      return "Please enable at least one search mode...";
    }
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
                  AI Chat
                </h1>
              </div>
            </div>

            {/* Search Mode Switches */}
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-3">
                {/* Docs Switch */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() =>
                      setSearchModes((prev) => ({ ...prev, docs: !prev.docs }))
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      searchModes.docs ? "bg-blue-600" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        searchModes.docs ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <div className="flex items-center space-x-1">
                    <FileText
                      className={`w-4 h-4 ${
                        searchModes.docs ? "text-blue-600" : "text-gray-400"
                      }`}
                    />
                    <span
                      className={`text-sm font-medium ${
                        searchModes.docs ? "text-blue-600" : "text-gray-400"
                      }`}
                    >
                      <span className="hidden sm:inline">Docs</span>
                      <span className="sm:hidden">D</span>
                    </span>
                  </div>
                </div>

                {/* Web Switch */}
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() =>
                      setSearchModes((prev) => ({ ...prev, web: !prev.web }))
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      searchModes.web ? "bg-blue-600" : "bg-gray-300"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        searchModes.web ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                  <div className="flex items-center space-x-1">
                    <Globe
                      className={`w-4 h-4 ${
                        searchModes.web ? "text-blue-600" : "text-gray-400"
                      }`}
                    />
                    <span
                      className={`text-sm font-medium ${
                        searchModes.web ? "text-blue-600" : "text-gray-400"
                      }`}
                    >
                      <span className="hidden sm:inline">Web</span>
                      <span className="sm:hidden">W</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="hidden md:flex items-center space-x-2 text-sm text-gray-500">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span>AI Assistant Online</span>
              </div>
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
                              textContent.match(/\[(\d+)\]\.?\s*/);
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
                          return message.text.replace(
                            /\[(\d+)\]\.?/g,
                            (match) => {
                              i++;
                              return `<sup>${match}<!--${i}--></sup>`;
                            }
                          );
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
                placeholder={getPlaceholderText()}
                disabled={!searchModes.docs && !searchModes.web}
                className={`w-full resize-none rounded-lg border border-gray-300 px-3 py-2 sm:px-4 sm:py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder:text-gray-500 text-black text-sm sm:text-base ${
                  !searchModes.docs && !searchModes.web
                    ? "bg-gray-100 cursor-not-allowed"
                    : ""
                }`}
                rows={1}
                style={{ minHeight: "44px", maxHeight: "120px" }}
              />
              <div className="absolute top-2 right-2 flex items-center space-x-1 text-xs text-gray-400">
                {searchModes.docs && <FileText className="w-3 h-3" />}
                {searchModes.web && <Globe className="w-3 h-3" />}
                <span className="hidden sm:inline">
                  {getActiveModes() || "No modes"}
                </span>
              </div>
            </div>
            <button
              onClick={handleSendMessage}
              disabled={
                !inputText.trim() ||
                isTyping ||
                (!searchModes.docs && !searchModes.web)
              }
              className="bg-blue-600 text-white rounded-lg px-4 py-2 sm:px-6 sm:py-3 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-1 sm:space-x-2 flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={!searchModes.docs && !searchModes.web}
              className={`rounded-lg px-4 py-2 sm:px-6 sm:py-3 transition-colors flex items-center space-x-1 sm:space-x-2 flex-shrink-0 ${
                isRecording
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-gray-300 text-gray-800 hover:bg-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
              }`}
            >
              {isRecording ? (
                <StopCircle className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          </div>

          <div className="mt-2 text-xs text-gray-500">
            Press Enter to send, Shift+Enter for new line •{" "}
            {getActiveModes()
              ? `Searching ${getActiveModes()}`
              : "Enable search modes to chat"}
          </div>
        </div>
      </div>
    </div>
  );
}
