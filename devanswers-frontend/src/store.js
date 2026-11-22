import { configureStore } from "@reduxjs/toolkit";
import userReducer from "./reducers/userSlice";
import questionReducer from "./reducers/questionSlice";
import themeReducer from "./reducers/themeSlice";
import aiReducer from "./reducers/aiSlice";

const store = configureStore({
  reducer: {
    user: userReducer,
    question: questionReducer,
    theme: themeReducer,
    ai: aiReducer,
  },
});

export default store;