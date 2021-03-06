/**
 * Created by Bouse on 02/16/2016
 */

(function () {

  'use strict';

  angular.module('ameuroca')

    .factory('updateDataUtils', function ($rootScope, $q, $http, apiFactory, objectUtils, managersService, momentService, transferDates, textManipulator, arrayMappers, dataRecovery) {

      var updateDataUtils = {};

      /**
       * @name updatePlayerPoolData
       * @description gets data from all of the players in all valid leagues
       */
      updateDataUtils.updatePlayerPoolData = function () {

        $log.debug('updateDataUtils -- updatePlayerPoolData');

        var defer = $q.defer(),
          allTeamsPromise = [],
          allPlayers = [];

        // returns a list of promise with the end point for each league
        apiFactory.getAllTeams().then(function (result) {
          //loop through each result
          _.each(result, function (leagueData) {
            _.each(leagueData.data, function (teamData) {
              // $log.debug('LEAGUE:', leagueData.slug, ', TEAM:', teamData.full_name);
              // returns a promise with the end point for each team
              var rosterRequest = apiFactory.getTeamRosterURL(leagueData.slug, teamData.id);
              allTeamsPromise.push(rosterRequest);
              rosterRequest.then(function (playerData) {
                _.each(playerData.data, function (eachPlayer) {
                  $log.debug(eachPlayer.team.full_name, ':', eachPlayer.full_name);
                });
                // each player on each team
                var rosterArray = _.map(playerData.data, arrayMappers.transferPlayersMap.bind(this, leagueData, teamData));
                allPlayers = allPlayers.concat(rosterArray);
              });
            });
            $q.all(allTeamsPromise).then(function(data) {
              $log.debug('resolve promise');
              defer.resolve(data);
            });
          });
        });

        return defer.promise;

      };

      /**
       * @name updateAllManagerData
       * @description gets data from all of the players in all valid leagues
       * @returns {promise}
       */
      updateDataUtils.updateAllManagerData = function (managerData) {

        $log.debug('updateDataUtils.updateAllManagerData()');

        var promises = [];

        apiFactory.getApiData('leagueTables');

        _.each(managerData, function (m) {
          var request = updateDataUtils.updateManagerData(m);
          promises.push(request);
        });

        return $q.all(promises);

      };

      /**
       * @name updateManagerData
       * @description update only one manager
       * @param cb
       * @param manager
       * @returns {promise}
       */
      updateDataUtils.updateManagerData = function (m) {

        $log.debug('updateDataUtils.updateManagerData()');

        var defer = $q.defer();
        var current = 0;
        var total = 0;
        var requestPlayer = function (p) {

          p = objectUtils.playerResetGoalPoints(p);

          p.manager = {
            // id: p.manager && p.manager.id || Math.round((Math.random() * 100)),
            name: m.managerName.capitalize()
          };

          m.monthlyGoalsLog = [];
          m.filteredMonthlyGoalsLog = [];
          m.charts = [];

          apiFactory.getPlayerProfile('soccer', p.player.id)
            .then(arrayMappers.playerInfo.bind(this, p), function () {
              $log.debug('failed at player info mapping:', p.player.name);
            })
            .then(arrayMappers.playerMapPersonalInfo.bind(this, p), function () {
              $log.debug('failed at player personal info mapping:', p.player.name);
            })
            .then(arrayMappers.playerGamesLog.bind(this, {
              player: p,
              manager: m
            }), function () {
              $log.debug('failed at player game logs', p.player.name);
            })
            .then(function (result) {
              current += 1;

              if (!_.isDefined(p.league)) {
                $log.warn('no p.league property', p);
              }

              if (!_.isDefined(p.league.name)) {
                $log.warn('no p.league.name property', p);
              }

              if (!_.isDefined(p.league.slugs)) {
                $log.warn('no p.league.slugs property', p);
              }

              m.players[p.player.id] = _.defaults(p, m.players[p.player.id]);

              if (current === total) {
                $log.debug('RESOLVE PROMISE:', p.manager.name);
                defer.resolve(m);
              }
            }, function () {
              $log.debug('failed at final stage:', p.player.name);
            });

        };

        if (angular.isDefined(m.players)) {

          // reset goal counts
          m = objectUtils.cleanManager(m, true);
          m._lastSyncedOn = momentService.syncDate();

          total = _.keys(m.players).length;
          _.each(m.players, requestPlayer);

        } else {
          $log.warn('try again, object does not contain \'players\' property');
        }

        return defer.promise;

      };

      /**
       * @name updateLeagueTables
       * @description gets all leagues in teams
       */
      updateDataUtils.updateLeagueTables = function () {

        $log.debug('updateDataUtils --> updateLeagueTables');

        var defer = $q.defer(),
          leagueTablesData = [];

        // returns a list of promise with the end point for each league
        $q.all(apiFactory.getLeagueTables())
          .then(function (promiseData) {

            leagueTablesData = _.map(promiseData, function (result, index) {

              if (index <= 2) {

                return {
                  data: _.map(result.data, arrayMappers.tableMap)
                };

              } else {

                return {
                  data: _.map(result.data, arrayMappers.tableTournamentMap)
                };

              }

            });

            defer.resolve(leagueTablesData);

          });

        return defer.promise;

      };

      /**
       * @name updateLeagueLeadersData
       * @description fetches all league leaders in goals
       */
      updateDataUtils.updateLeagueLeadersData = function () {

        $log.debug('updateDataUtils --> updateLeagueLeadersData');

        var allLeagues = [],
          defer = $q.defer(),
        // list of all goal scorers in all leagues
          consolidatedGoalScorers = [],
        // makes a request for all leagues in a loop returns a list of promises
          allPromises = apiFactory.getAllGoalLeaders();

        // waits for an array of promises to resolve, sets allLeagues data
        $q.all(allPromises)
          .then(function (result) {
            allLeagues = [];
            _.each(result, function (league) {
              var goalsMap = league.data.goals.map(arrayMappers.goalsMap.bind(arrayMappers, $rootScope.managerData, league.leagueURL));
              allLeagues.push({
                name: textManipulator.properLeagueName(league.leagueName),
                source: goalsMap,
                className: league.leagueName,
                img: textManipulator.leagueImages[league.leagueName]
              });
              consolidatedGoalScorers = consolidatedGoalScorers.concat(goalsMap);
            });

            defer.resolve(allLeagues);

          });

        return defer.promise;

      };

      /**
       * @name recoverFromManagerCore
       * @returns {promise}
       */
      updateDataUtils.recoverFromManagerCore = function () {

        var defer = $q.defer();

        $q.all([apiFactory.getApiData('managerCore')])

          .then(function () {

            var rebuildTeams = {
              data: {},
              _lastSyncedOn: momentService.syncDate()
            };

            $log.debug('CORE DATA', $rootScope.managerCore.data);

            _.each($rootScope.managerCore.data, function (m) {

              var managerKey = m.managerName.toLowerCase();

              _.each(m.players, function (p) {

                if (!_.isDefined(rebuildTeams.data[managerKey])) {
                  rebuildTeams.data[managerKey] = {};
                  rebuildTeams.data[managerKey].managerName = managerKey.capitalize();
                  rebuildTeams.data[managerKey].players = {};
                }

                // !_.isDefined(player.pickNumber) && (player.pickNumber = 999);
                !_.isDefined(p.dateOfTransaction) && (p.dateOfTransaction = transferDates.leagueStart.date);

                rebuildTeams.data[managerKey].players[p.player.id] = p;

              });

            });

            _.each(rebuildTeams.data, function(manager, key) {

              _.each(manager.players, function(p) {

                var currentPlayers = dataRecovery.draftOrder[key];

                _.each(currentPlayers, function(element, index) {

                  if (!_.isDefined(p.player.name)) {
                    //$log.debug('> player name not found', p);
                  } else {
                    if (p.player.name.toLowerCase() === element.toLowerCase()) {
                      p.pickNumber = index + 1;
                    }
                  }

                });

              });

            });

            defer.resolve(rebuildTeams);

          });

        return defer.promise;

      };

      /**
       * @name recoverFromPoolData
       * @returns {promise}
       */
      updateDataUtils.recoverFromPoolData = function () {

        var defer = $q.defer();

        $q.all([apiFactory.getApiData('managerCore'), apiFactory.getApiData('playerPoolData')])

          .then(function () {

            var rebuildTeams = {
              data: {},
              _lastSyncedOn: momentService.syncDate()
            };

            _.each($rootScope.playerPoolData.allPlayers, function (player) {

              if (player.status === 'drafted' || player.status === 'added' || player.status === 'dropped') {

                var managerKey = player.managerName.toLowerCase();

                if (!_.isDefined(rebuildTeams.data[managerKey])) {
                  rebuildTeams.data[managerKey] = {};
                  rebuildTeams.data[managerKey].managerName = player.managerName;
                  rebuildTeams.data[managerKey].players = {};
                }

                rebuildTeams.data[managerKey].players[player.id] = player;

              }
            });

            defer.resolve(rebuildTeams);

          });

        return defer.promise;

      };

      return updateDataUtils;

    });

})();
