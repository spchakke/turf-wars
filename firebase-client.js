import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC000ztA_x_KxGnKva4zqBZ7DCwOhQxZQA",
  authDomain: "turf-wars-b6ea0.firebaseapp.com",
  databaseURL: "https://turf-wars-b6ea0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "turf-wars-b6ea0",
  storageBucket: "turf-wars-b6ea0.firebasestorage.app",
  messagingSenderId: "231555430819",
  appId: "1:231555430819:web:e02b15ad623d62031a8216",
  measurementId: "G-2SVQE2VBKT"
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
