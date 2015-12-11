/**
 * General function used throughout the package
 */

"use strict";

var pkgcloud = require("pkgcloud"), _ = require("underscore"), async = require("async");

/**
 * Logs an error (if existing) on the Grunt error log, and calls the callback
 * 
 * @param {Object}
 *          err Error object
 * @param {Function}
 *          done Callback
 */
module.exports.dealWithError = function(err, done) {

  if (err) {
    require("grunt").log.error(err);
    if (done) {
      return done();
    }
  }
};

/**
 * Returns the name of node given some parameters
 * 
 * @param {String}
 *          clusterName Name of cluster the node belongs to (must not contain
 *          dashes)
 * @param {String}
 *          nodeType Type of node (must not contain dashes)
 * @param {Number}
 *          seq Sequential number of node
 * 
 * @returns {String} Name of the node
 */
module.exports.nodeName = function(clusterName, nodeType, seq) {
  return clusterName + "-" + seq + "-" + nodeType;
};

/**
 * Returns the type of a node given its name
 * 
 * @param {String}
 *          nodeName Name of node
 * 
 * @returns {String} Type of node
 */
module.exports.nodeType = function(nodeName) {
  return nodeName.split("-")[2];
};

/**
 * Returns a compute client based on the given options
 * 
 * @see https://github.com/pkgcloud/pkgcloud/tree/master/docs/providers
 * @param {Object}
 *          options Options for client creation
 * @param {Function}
 *          doneError Callback to call in case of error
 */
module.exports.getComputeClient = function(options, doneError) {

  try {
    if (!options) {
      throw new Error("Missing client configuration");
    }
    return pkgcloud.compute.createClient(options);
  } catch (err) {
    module.exports.dealWithError(err, doneError);
  }
};

/**
 * Returns a network client based on the given options
 * 
 * @see https://github.com/pkgcloud/pkgcloud/tree/master/docs/providers
 * @param {Object}
 *          options Options for client creation
 * @param {Function}
 *          doneError Callback to call in case of error
 */
module.exports.getNetworkClient = function(options, doneError) {

  try {
    if (!_.is(options)) {
      throw new Error("Missing client configuration");
    }
    return pkgcloud.network.createClient(options);
  } catch (err) {
    module.exports.dealWithError(err, doneError);
  }
};

/**
 * Returns a list of servers based on the server types defined in options
 * 
 * @param {Function}
 *          namingFunction Function used to compose the name of a server given
 *          its type and a sequence number
 * @param {Object}
 *          serverTypes The server types definition object of Gruntfile
 * @return {Array} Array of Objects containing all server definitions with
 *         replication (name is changed to the actual server one)
 */
module.exports.getDefineNodes = function(namingFunction, serverTypes) {
  var optServers = [];
  var nodeNumber = 0;

  serverTypes.forEach(function(serverType) {
    var i;
    for (i = 1; i <= serverType.replication; i++) {
      var server = _.clone(serverType);
      server.type = serverType.name;
      server.name = namingFunction(serverType.name, ++nodeNumber);
      optServers.push(server);
    }
  });

  return optServers;
};

/**
 * Returns security groups in the format favored from OpenStack.
 * 
 * @param {Array}
 *          secGroups Array of security group names
 * @return {Array} Array of Objects with name property only (like:
 *         "[{\"name\":\"secgroup1\"}, {\"name\":\"secgroup2\"}]")
 */
module.exports.securityGroupsAsOpenstack = function(secGroups) {
  return _.map(secGroups, function(e) {
    return {
      name : e
    };
  });
};

/**
 * Returns the complete name of the image (including registry and version)
 * 
 * @param {String}
 *          imageName
 * @param {String}
 *          registryIn
 * @param {String}
 *          versionIn
 * @return {String} The qualified image name
 */
module.exports.qualifiedImageName = function(imageName, registryIn, versionIn) {
  var version = (versionIn) ? ":" + versionIn : "";
  var registry = (registryIn) ? registryIn + "/" : "";
  return registry + imageName + version;
};

/**
 * Executes a function over the intersection of the servers active in the
 * cluster and the ones passed in a list
 * 
 * @param {Object}
 *          options Task options
 * @param {Array}
 *          nodes Array of the servers as defined in the Gruntfile
 * @param {Array}
 *          images Array of images as defined in the Gruntfile
 * @param {Function}
 *          iterator The function is passed an Object containing the iterator
 *          parameters, and a callback function to call when one iteration is
 *          complete (the callback is, if in error, sent an error object)
 * @param {Function}
 *          done Callback to call when the requests are completed (an err
 *          parameter is passed if an error occurred)
 */
module.exports.iterateOverNodes = function(options, nodes, iterator, done) {

  // Retrieves the active nodes IP addresses
  var computeClient = pkgcloud.compute.createClient(options.pkgcloud.client);

  computeClient.getServers({}, function(err, activeNodes) {
    module.exports.dealWithError(err, done);

    // Selects only the servers that have their names defined in nodes
    var selNodes = _.filter(activeNodes, function(node) {
      if (_.pluck(nodes, "name").indexOf(node.name) >= 0) {
        return true;
      }
    });

    // Extracts some data about the selected nodes and puts them back into
    // selNodes
    selNodes = _.map(selNodes, function(node) {
      return {
        id : node.id,
        name : node.name,
        address : node.addresses.public[0],
        type : module.exports.nodeType(node.name)
      };
    });

    // Collects data from each nodes that is in selNodes, and sets data for
    // the iterator in the data array
    var data = [];
    selNodes.forEach(function(node) {
      var imageNames = _.filter(options.nodetypes, function(nodetype) {
        return nodetype.name === node.type
      })[0].images;

      var images = [];
      imageNames.forEach(function(imageName) {
        var image= options.images[imageName];
        image.name= imageName;
        images.push(image);
      });

      data.push({
        hosts : node.hosts,
        node : node,
        images : images,
        docker : {
          protocol : options.docker.client.protocol,
          host : node.address,
          port : options.docker.client.port
        },
        auth : options.docker.client.auth
      });
    });

    // Calls the iterator for all the elements in data
    async.eachSeries(data, iterator, done);
  });
};
