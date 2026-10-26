const authRoutes = require("./authRoutes");
const userRoutes = require("./userRoutes");
const scanRoutes = require("./scanRoutes");
const pairRoutes = require("./pairRoutes");
const pairInvitationRoutes = require("./pairInvitationRoutes");
const postcardRoutes = require("./postcardRoutes");
const deviceRoutes = require("./deviceRoutes");
const { API_VERSION } = require("../utils/constant");

module.exports = (app) => {
  const apiBasePath = `/${API_VERSION}`;

  // Route cho auth
  app.use(`${apiBasePath}/auth-service`, authRoutes);

  // Route cho user
  app.use(`${apiBasePath}/user-service`, userRoutes);

  // Route cho scan
  app.use(`${apiBasePath}/scan-service`, scanRoutes);

  app.use(`${apiBasePath}/pairs`, pairRoutes);
  app.use(`${apiBasePath}/postcards`, postcardRoutes);
  app.use(`${apiBasePath}/devices`, deviceRoutes);
  app.use(
  `${apiBasePath}/pair-invitations`,
  pairInvitationRoutes
);
};
