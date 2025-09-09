const axios = require("axios");
const jsdom = require("jsdom");
const express = require("express");
const app = express();
const { JSDOM } = jsdom;
const Codechef = require("../models/contestModels/codechefModel");
const User = require("../models/userModel");
const { get } = require("mongoose");
const codechefWinnersModel = require("../models/contestModels/codechefWinnersModel");
const backendUrl = process.env.BACKEND_URI;

// Helper function for delay between requests
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Configure axios instance for CodeChef with rate limiting
const codechefAxios = axios.create({
  baseURL: 'https://www.codechef.com',
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
  },
  timeout: 10000,
  validateStatus: (status) => status == 404 || (status >= 200 && status < 300)
});

// Retry wrapper for axios requests
async function retryRequest(url, retries = 3, delayMs = 3000) {
  try {
    await delay(delayMs);
    const response = await codechefAxios.get(url);
    return response;
  } catch (error) {
    if (retries <= 0) throw error;
    
    if (error.response && error.response.status === 429) {
      console.log(`Rate limited. Retrying in ${delayMs}ms... (${retries} retries left)`);
      return retryRequest(url, retries - 1, delayMs * 2); // Exponential backoff
    }
    throw error;
  }
}

// @desc Get codechef profile
// @route Get api/contests/codechef/:id
// @access public
const getCodechefProfile = async (req, res) => {
  try {
    const apiKey = req.headers.authorization;
    if (apiKey !== `Bearer ${process.env.API_KEY}`) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const response = await retryRequest(`/users/${req.params.id}`);

    if (response.status === 404) {
      return res
        .status(404)
        .json({ success: false, error: "CodeChef profile not found" });
    }

    // Parse HTML
    const dom = new JSDOM(response.data);
    const document = dom.window.document;

    // Check if we got a challenge page
    const challengeTitle = document.querySelector('title');
    if (challengeTitle && challengeTitle.textContent.includes('Just a moment')) {
      throw new Error('Cloudflare challenge detected. Please try again later.');
    }

    // Extract information with proper error handling
    const getUserDetail = (selector, attribute = 'textContent') => {
      const element = document.querySelector(selector);
      return element ? (attribute === 'textContent' ? element.textContent.trim() : element[attribute]) : null;
    };

    const profileImage = getUserDetail('.user-details-container img', 'src');
    const name = getUserDetail('.user-details-container h1');
    
    const ratingNumber = getUserDetail('.rating-number');
    const currentRating = ratingNumber ? parseInt(ratingNumber) : null;
    
    const highestRatingText = getUserDetail('.rating-number')?.parentNode?.children[4]?.textContent;
    const highestRating = highestRatingText ? parseInt(highestRatingText.split("Rating")[1]) : null;
    
    const countryFlag = getUserDetail('.user-country-flag', 'src');
    const countryName = getUserDetail('.user-country-name');
    
    const globalRankElement = document.querySelector('.rating-ranks li:nth-child(1) a');
    const globalRank = globalRankElement ? parseInt(globalRankElement.textContent) : null;
    
    const countryRankElement = document.querySelector('.rating-ranks li:nth-child(2) a');
    const countryRank = countryRankElement ? parseInt(countryRankElement.textContent) : null;
    
    const stars = getUserDetail('.rating') || 'unrated';
    
    const contestGlobalRankElement = document.querySelector('.global-rank');
    const contestGlobalRank = contestGlobalRankElement ? parseInt(contestGlobalRankElement.textContent) : null;
    
    const contestRatingDiffElement = document.querySelector('.rating-difference');
    const contestRatingDiff = contestRatingDiffElement ? parseInt(contestRatingDiffElement.textContent) : null;
    
    const contestNameElement = document.querySelector('.contest-name a');
    const contestName = contestNameElement ? contestNameElement.textContent.trim() : null;

    // Send success response
    res.status(200).json({
      success: true,
      profile: profileImage,
      name,
      currentRating,
      highestRating,
      countryFlag,
      countryName,
      globalRank,
      countryRank,
      stars,
      contestGlobalRank,
      contestRatingDiff,
      contestName,
    });
  } catch (error) {
    console.error('Error in getCodechefProfile:', error);
    const statusCode = error.message.includes('Unauthorized') ? 401 : 
                      error.message.includes('Cloudflare') ? 429 : 404;
    res.status(statusCode).json({ 
      success: false, 
      error: error.message || 'Failed to fetch CodeChef profile' 
    });
  }
};

// @desc Get codechef user from own database
// @route Get api/contests/codechef/:id
// @access public
const getCodechefUser = async (req, res) => {
  try {
    const apiKey = req.headers.authorization;
    if (apiKey !== `Bearer ${process.env.API_KEY}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const codechefUser = await Codechef.findOne({ user_id: req.params.id });
    if (!codechefUser) {
      return res.status(404).json({ error: "User not found" });
    }
    res.status(200).json({ success: true, data: codechefUser });
  } catch (error) {
    console.error('Error in getCodechefUser:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || "Internal server error" 
    });
  }
};

// @desc Update codechef profile
// @route PUT api/contests/codechef/:id
// @access public
const updateCodechefProfile = async (req, res) => {
  try {
    const apiKey = req.headers.authorization;
    if (apiKey !== `Bearer ${process.env.API_KEY}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!user.codechefId) {
      return res.status(400).json({ error: "CodeChef ID not set for this user" });
    }

    try {
      const response = await axios.get(
        `${backendUrl}/api/contests/codechef/${user.codechefId}`,
        { 
          headers: { Authorization: `Bearer ${process.env.API_KEY}` },
          timeout: 10000
        }
      );

      const responseData = response.data;
      if (!responseData.success) {
        throw new Error(responseData.error || "Failed to fetch CodeChef data");
      }

      const codechef = await Codechef.findOne({ user_id: req.params.id });
      if (!codechef) {
        return res.status(404).json({ error: "CodeChef profile not found" });
      }

      // Update profile
      codechef.success = true;
      codechef.profile = responseData.profile;
      codechef.name = responseData.name;
      codechef.currentRating = responseData.currentRating;
      codechef.highestRating = responseData.highestRating || null;
      codechef.globalRank = responseData.globalRank || null;
      codechef.countryRank = responseData.countryRank || null;
      codechef.contestGlobalRank = responseData.contestGlobalRank || null;
      codechef.contestRatingDiff = responseData.contestRatingDiff || null;
      codechef.contestName = responseData.contestName || null;
      
      if (responseData.stars && responseData.stars.match(/\d+/)) {
        codechef.stars = parseInt(responseData.stars.match(/\d+/)[0], 10);
      } else {
        codechef.stars = 1;
      }

      await codechef.save();
      
      // Update user image if profile image exists
      if (responseData.profile) {
        user.userImg = responseData.profile;
        await user.save();
      }

      res.status(200).json({ success: true, data: codechef });
    } catch (error) {
      console.error('Error updating CodeChef profile:', error);
      throw error;
    }
  } catch (err) {
    console.error('Error in updateCodechefProfile:', err);
    const statusCode = err.response?.status || 500;
    res.status(statusCode).json({ 
      success: false, 
      error: err.message || "Failed to update CodeChef profile" 
    });
  }
};

// @desc Enroll user
// @route PUT api/contests/codechef/enroll/:id
// @access public
const enrollUser = async (req, res) => {
  const apiKey = req.headers.authorization;
  if (apiKey !== `Bearer ${process.env.API_KEY}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const codechefUser = await Codechef.findOne({ user_id: req.params.id });
    if (!codechefUser) {
      res.status(404);
      throw new Error("User not found");
    }
    codechefUser.isEnrolled = true;
    await codechefUser.save();
    res.status(200).send({ success: true, data: codechefUser });
  } catch (error) {
    console.error(error);
    res.send({ error: "can't find user" });
  }
};

// @desc update the codechefId datails after every contests
// @route PUT api/contests/codechef/update/allusers
// @access public
const updateAllCodechefProfiles = async (req, res) => {
  const apiKey = req.headers.authorization;
  if (apiKey !== `Bearer ${process.env.API_KEY}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const headers = { Authorization: apiKey };
    const userData = await User.find({ codechefId: { $exists: true } });

    for (const user of userData) {
      const codechef = await Codechef.findOne({ user_id: user._id });

      // Skip deleted or missing users instead of throwing
      if (!codechef) {
        console.warn(`Skipping deleted/missing user: ${user.username}`);
        continue;
      }

      try {
        const response = await axios.get(`${backendUrl}/api/contests/codechef/${user.codechefId}`, { headers });
        const responseData = response.data;

        let stars = 1;
        if (responseData.stars && responseData.stars.match(/\d+/)) {
          stars = parseInt(responseData.stars.match(/\d+/)[0], 10);
        }

        codechef.set({
          currentRating: responseData.currentRating,
          highestRating: responseData.highestRating,
          globalRank: responseData.globalRank,
          countryRank: responseData.countryRank,
          stars: stars,
          contestGlobalRank: responseData.contestGlobalRank,
          contestRatingDiff: responseData.contestRatingDiff,
          contestName: responseData.contestName,
          profile: responseData.profile,
          isEnrolled: false,
        });

        await codechef.save();
        console.log(`stored ${user.username}`);
      } catch (err) {
        console.error(`Error updating profile for ${user.username}:`, err);
        continue; // skip errors for individual users
      }
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: "Internal Server Error" });
  }
};

// @desc generate all winners
// @route GET api/contests/codechef/generate/allwinners/:contestName
// @access public
const generateWinners = async (req, res) => {
  const apiKey = req.headers.authorization;
  if (apiKey !== `Bearer ${process.env.API_KEY}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const searchQuery = req.params.contestName;

    const partialMatchParticipants = await Codechef.find({
      contestName: { $regex: new RegExp(searchQuery, "i") },
      success: true,
    })
      .select("_id contestName stars contestGlobalRank contestRatingDiff")
      .populate("user_id", "username libId branch section codechefId rollNo userImage yearOfStudy");

    const exactMatchParticipants = await Codechef.find({
      contestName: searchQuery,
      success: true,
    }).select("-_id user_id");

    const allParticipantsSet = new Set([
      ...partialMatchParticipants,
      ...exactMatchParticipants,
    ]);
    const allParticipants = [...allParticipantsSet];
    allParticipants.sort((a, b) => a.contestGlobalRank - b.contestGlobalRank);

    const winnersData = allParticipants.map((participant) => ({
      user_id: participant.user_id._id,
      username: participant.user_id.username,
      branch: participant.user_id.branch,
      libId: participant.user_id.libId,
      section: participant.user_id.section,
      rollNo: participant.user_id.rollNo,
      userImage: participant.user_id.userImage,
      yearOfStudy: participant.user_id.yearOfStudy,
      codechefId: participant.user_id.codechefId,
      contestName: participant.contestName,
      contestGlobalRank: participant.contestGlobalRank,
      contestRatingDiff: participant.contestRatingDiff,
      stars: participant.stars,
    }));

    const existingContest = await codechefWinnersModel.findOne({
      contestName: searchQuery,
    });

    if (existingContest) {
      existingContest.winners.push(...winnersData);
      console.log(existingContest.winners);
      await existingContest.save();
    } else {
      // Create a new CodechefWinners document
      await codechefWinnersModel.create({
        contestName: searchQuery,
        winners: winnersData,
      });
    }

    res.status(200).json({ success: true, data: winnersData });
  } catch (error) {
    console.error("Error retrieving contest participants:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// @desc Get all winners by contest name
// @route GET api/contests/codechef/get/allwinners/:contestName
// @access public
const getContestsAllWinners = async (req, res) => {
  const apiKey = req.headers.authorization;
  if (apiKey !== `Bearer ${process.env.API_KEY}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const contestName = req.params.contestName;
    const contestWinners = await codechefWinnersModel.findOne({
      contestName: new RegExp(contestName, "i"),
    });

    if (!contestWinners) {
      res.status(404);
      throw new Error("Contest not found");
    }

    res.status(200).json({ success: true, data: contestWinners });
  } catch (error) {
    console.error("Error retrieving contest winners:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// @desc Get all winners
// @route GET api/contests/codechef/get/allwinners
// @access public
const getAllWinners = async (req, res) => {
  const apiKey = req.headers.authorization;
  if (apiKey !== `Bearer ${process.env.API_KEY}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const contestWinners = await codechefWinnersModel.find();

    if (!contestWinners) {
      res.status(404);
      throw new Error("Contest not found");
    }

    res.status(200).json({ success: true, data: contestWinners });
  } catch (error) {
    console.error("Error retrieving contest winners:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

module.exports = {
  getCodechefProfile,
  getCodechefUser,
  updateCodechefProfile,
  enrollUser,
  updateAllCodechefProfiles,
  generateWinners,
  getAllWinners,
  getContestsAllWinners,
};
