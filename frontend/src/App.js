import React, { useState, useEffect } from "react";
import axios from "axios";
import { QRCodeCanvas } from 'qrcode.react';

const App = () => {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [phoneCodeHash, setPhoneCodeHash] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authStep, setAuthStep] = useState("qr");
  const [sessionToken, setSessionToken] = useState("");
  const [popupVisible, setPopupVisible] = useState(false);
  const [qrCodeLink, setQrCodeLink] = useState(null);
    const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  const [user, setUser] = useState(null);

  const backendUrl = "http://localhost:5000"; 
  
  const generateQRCode = async () => {
    try {
      console.log("Starting QR code generation...");
      const response = await axios.get(`${backendUrl}/generate-qr`);
      console.log("QR generation response:", response.data);
      
      if (response.data.loginLink) {
        console.log("Setting QR code link:", response.data.loginLink);
        setQrCodeLink(response.data.loginLink);
        setSessionToken(response.data.sessionToken);
        startCheckingSession(response.data.sessionToken);
      } else {
        console.error("No login link in response");
        setError('Invalid QR code response');
      }
    } catch (error) {
      console.error("QR generation error:", error);
      setError(error.response?.data?.error || 'Failed to generate QR code');
      setQrCodeLink(null);
    }
  };

  const verifyQRLogin = async (token) => {
    try {
      console.log("Verifying QR login with token:", token);
      const response = await axios.post(`${backendUrl}/verify-qr-login`, {
        sessionToken: token
      });

      if (response.data.status === 'success') {
        console.log("QR login verified successfully:", response.data);
        setUser(response.data.user);
        setSessionToken(response.data.sessionToken);
        setIsAuthenticated(true);
        setPopupVisible(true);
        return true;
      }
      return false;
    } catch (error) {
      console.error("QR login verification error:", error);
      return false;
    }
  };

  
  const startCheckingSession = (token) => {
    console.log("Starting session check with token:", token);
    
    if (!token) {
      console.error("No token provided for session checking");
      setError("Invalid session token");
      return;
    }
  
    const interval = setInterval(async () => {
      try {
        console.log("Checking session...");
        const response = await axios.get(`${backendUrl}/check-session`, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        console.log("Session check response:", response.data);
        
        if (response.data.isActive) {
          console.log("Session is active, user data:", response.data.user);
          setUser(response.data.user);
          setIsAuthenticated(true);
          setPopupVisible(true);
          clearInterval(interval);
        }
      } catch (error) {
        console.error("Session check error:", error);
        setError(error.response?.data?.message || "Session check failed");
        
        if (error.response?.status === 401 || error.response?.status === 403) {
          console.log("Session is invalid, stopping checks");
          clearInterval(interval);
          setQrCodeLink(null);
        }
      }
    }, 3000);
  
    const timeoutId = setTimeout(() => {
      console.log("QR code session timeout");
      clearInterval(interval);
      setError("QR code expired. Please generate a new one.");
      setQrCodeLink(null);
    }, 120000);
  
    return () => {
      clearInterval(interval);
      clearTimeout(timeoutId);
    };
  };


  const sendOTP = async () => {
    try {
      const response = await axios.post(`${backendUrl}/send-otp`, { phoneNumber });
      setPhoneCodeHash(response.data.phoneCodeHash);
      setAuthStep("otp");
      setError(null);
    } catch (error) {
      setError(error.response?.data?.message || "Failed to send OTP");
    }
  };

  const validateOTP = async () => {
    try {
      const response = await axios.post(`${backendUrl}/validate-otp`, {
        phoneNumber,
        otp,
        phoneCodeHash,
      });
      setSessionToken(response.data.sessionToken);
      setUser(response.data.user);
      setIsAuthenticated(true);
      setError(null);
      setPopupVisible(true);
    } catch (error) {
      setError(error.response?.data?.message || "OTP Validation Failed");
    }
  };

  const openShiroChat = () => {
    window.open("https://t.me/shiro_0bot?start=start", "_blank");
  };



  const renderPopup = () => (
    popupVisible && (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        backgroundColor: "#17212c",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        zIndex: 1000,
      }}>
        <div style={{
          position: "relative",
          backgroundColor: "#2b5279",
          padding: "20px",
          borderRadius: "10px",
          width: "400px",
          textAlign: "center",
          boxShadow: "0px 4px 6px rgba(0, 0, 0, 0.2)",
        }}>
          <button
            onClick={() => setPopupVisible(false)}
            style={{
              position: "absolute",
              top: "-0px",
              right: "-1px",
              backgroundColor: "#FF0000",
              border: "none",
              color: "#fff",
              fontSize: "20px",
              cursor: "pointer",
              width: "30px",
              height: "30px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              boxShadow: "0px 2px 4px rgba(0, 0, 0, 0.2)",
            }}
          >&times;</button>
          <h2 style={{ marginBottom: "20px", color: "#fff" }}>
            Shiro is connected!
          </h2>
          <p style={{ marginBottom: "20px", color: "#fff" }}>
            You will now get summaries based on your chats.
            <br />
            <strong>@shiro_0bot</strong>
          </p>
          <button
            onClick={openShiroChat}
            style={{
              padding: "10px 20px",
              backgroundColor: "#00a884",
              color: "#fff",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
              fontWeight: "bold",
            }}
          >
            Open Shiro
          </button>
        </div>
      </div>
    )
  );

  const renderQRSection = () => (
    <div style={{ textAlign: "center" }}>
      <p style={{ marginBottom: "20px" }}>
        Go to Telegram: Settings, tap on Devices and scan.
      </p>
      {error && (
        <div style={{
          color: "#ff4444",
          marginBottom: "10px",
          padding: "10px",
          backgroundColor: "rgba(255, 0, 0, 0.1)",
          borderRadius: "5px"
        }}>
          {error}
        </div>
      )}
      {!qrCodeLink && (
        <button
          onClick={generateQRCode}
          style={{
            width: "100%",
            padding: "10px",
            backgroundColor: "#00a884",
            color: "#fff",
            border: "none",
            borderRadius: "5px",
            cursor: "pointer",
            marginBottom: "20px",
          }}
        >
          Generate QR
        </button>
      )}
      {qrCodeLink && (
        <div>
          <QRCodeCanvas
            value={qrCodeLink}
            size={200}
            style={{ margin: "0 auto" }}
          />
          <button
            onClick={() => {
              setQrCodeLink(null);
              setError(null);
            }}
            style={{
              marginTop: "10px",
              padding: "5px 10px",
              backgroundColor: "#ff4444",
              color: "#fff",
              border: "none",
              borderRadius: "5px",
              cursor: "pointer",
            }}
          >
            Reset QR Code
          </button>
        </div>
      )}
    </div>
  );

  const renderAuthStep = () => (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
      backgroundColor: "#17212b",
      color: "#fff",
    }}>
      <div style={{
        width: "300px",
        padding: "20px",
        backgroundColor: "#2a5277",
        borderRadius: "10px",
      }}>
        <div style={{
          display: "flex",
          justifyContent: "center",
          marginBottom: "20px",
        }}>
          <button
              onClick={() => {
                setAuthStep("qr");
                setError(null);
                setQrCodeLink(null);
              }}
            style={{
              padding: "10px 20px",
              backgroundColor: authStep === "qr" ? "#00a884" : "transparent",
              color: "#fff",
              border: "none",
              borderRadius: "5px 0 0 5px",
              cursor: "pointer",
            }}
          >
            QR Code
          </button>
          <button
             onClick={() => {
              setAuthStep("phone");
              setError(null);
            }}
            style={{
              padding: "10px 20px",
              backgroundColor: authStep === "phone" ? "#00a884" : "transparent",
              color: "#fff",
              border: "none",
              borderRadius: "0 5px 5px 0",
              cursor: "pointer",
            }}
          >
            Phone
          </button>
        </div>

        {authStep === "qr" ? renderQRSection()  : authStep === "phone" ? (
          <div>
            <h2 style={{ textAlign: "center", marginBottom: "20px" }}>
              Enter Phone Number
            </h2>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1234567890"
              style={{
                width: "93%",
                padding: "10px",
                marginBottom: "15px",
                backgroundColor: "#17212b",
                color: "#fff",
                border: "1px solid #2a5277",
                borderRadius: "5px",
              }}
            />
            <button
              onClick={sendOTP}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "#00a884",
                color: "#fff",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
              }}
            >
              Send OTP
            </button>
          </div>
        ) : (
          <div>
            <h2 style={{ textAlign: "center", marginBottom: "20px" }}>Enter OTP</h2>
            <input
              type="text"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              placeholder="Enter OTP"
              style={{
                width: "93%",
                padding: "10px",
                marginBottom: "15px",
                backgroundColor: "#17212b",
                color: "#fff",
                border: "1px solid #2a5277",
                borderRadius: "5px",
              }}
            />
            <button
              onClick={validateOTP}
              style={{
                width: "100%",
                padding: "10px",
                backgroundColor: "#00a884",
                color: "#fff",
                border: "none",
                borderRadius: "5px",
                cursor: "pointer",
              }}
            >
              Validate OTP
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {renderPopup()}
      {renderAuthStep()}
    </>
  );
};

export default App;




