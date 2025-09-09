const CodechefWinners = require("../models/contestModels/codechefWinnersModel");
const CodechefWinnersArchive = require("../models/contestModels/codechefWinnersArchiveModel");

async function archiveAndDeleteContest(contestId) {
  try {
    // Find the document in the original collection
    const contestDoc = await CodechefWinners.findById(contestId);

    if (!contestDoc) {
      console.log("Contest not found");
      return;
    }

    // Convert to plain object and remove _id
    const archiveDoc = contestDoc.toObject();
    delete archiveDoc._id;

    // Save it to the archive collection
    const archived = await CodechefWinnersArchive.create(archiveDoc);
    console.log("Archived successfully:", archived);

    // Delete from original collection
    await CodechefWinners.findByIdAndDelete(contestId);
    console.log("Deleted from original collection");

  } catch (err) {
    console.error("Error archiving contest:", err);
  }
}

module.exports = archiveAndDeleteContest;
