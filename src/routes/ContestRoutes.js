const express = require("express");
const router = express.Router();
const {
  getContests,
  getContest,
  postContests,
  updateContest,
} = require("../controllers/ContestControllers");
const { 
  getCodechefProfile,
  updateCodechefProfile,
  enrollUser
} = require("../controllers/CodechefController");

router.route("/").get(getContests).post(postContests);
router.route("/:id").get(getContest).put(updateContest);
router.route("/codechef/:id").get(getCodechefProfile).put(updateCodechefProfile);
router.route("/codechef/enroll/:id").put(enrollUser);
// router.route("/codechef/:id").get(getCodechefProfile).post(updateCodechefProfile);

module.exports = router;
