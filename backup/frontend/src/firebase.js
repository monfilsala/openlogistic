import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyApGiVT2c1rrBtbmPX3MA1FNdqspAUZaJI",
    authDomain: "entrega2-delivery-app.firebaseapp.com",
    projectId: "entrega2-delivery-app",
    storageBucket: "entrega2-delivery-app.firebasestorage.app",
    messagingSenderId: "687677439968",
    appId: "1:687677439968:web:715cc3b7e4464a92557585"
  };

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);