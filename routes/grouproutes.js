const express = require("express");
const router = express.Router();
const {
    creategroupSessionfn,
    getGroupSessionfn,
    joinGroupfn,
    toggleReadyfn,
    getParticipantsfn,
    kickParticipantfn,
    getGroupCartfn,
    addGroupCartItemfn,
    updateGroupCartItemfn,
    removeGroupCartItemfn,
    placeGroupOrderfn
} = require("../controllers/groupcontrollers")


router.post("/group-sessions", creategroupSessionfn)
router.get("/group-sessions/:joinCode", getGroupSessionfn)
router.post("/group-sessions/:joinCode/join", joinGroupfn)

router.get("/group-sessions/:joinCode/participants", getParticipantsfn)
router.patch("/group-sessions/:joinCode/participants/:userId/ready", toggleReadyfn)
router.delete("/group-sessions/:joinCode/participants/:participantId", kickParticipantfn)

router.get("/group-sessions/:joinCode/cart", getGroupCartfn)
router.post("/group-sessions/:joinCode/cart", addGroupCartItemfn)
router.patch("/group-sessions/:joinCode/cart/:productId", updateGroupCartItemfn)
router.delete("/group-sessions/:joinCode/cart/:productId", removeGroupCartItemfn)

router.post("/group-sessions/:joinCode/order", placeGroupOrderfn)

module.exports = router;
