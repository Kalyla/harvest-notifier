require('dotenv').config();
const fetch = require('node-fetch');
const moment = require('moment');
require('moment/locale/ru');
moment.locale('ru');

async function getHarvestUsers(accountId, token, excludedUsers) {
  console.log('getHarvestUsers');
  const response = await fetch('https://api.harvestapp.com/v2/users', {
    method: 'get',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Harvest-Account-Id': accountId,
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  return data.users.filter(
    (user) => user.is_active && (!excludedUsers || !excludedUsers.split(',').includes(user.email))
  );
}

async function getStatustimer(accountId, token, userID) {
  console.log('getStatustimer');
  const response = await fetch(`https://api.harvestapp.com/v2/time_entries?user_id=${userID}&is_running=true`, {
    method: 'get',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Harvest-Account-Id': accountId,
      Authorization: `Bearer ${token}`,
    },
  });
  
  const data = await response.json();
  return data.time_entries;
}

async function getHarvestTeamTimeReport(accountId, token, dateFrom, dateTo) {
  console.log('getHarvestTeamTimeReport');
  const response = await fetch(
    `https://api.harvestapp.com/v2/reports/time/team?from=${dateFrom}&to=${dateTo}`,
    {
      method: 'get',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Harvest-Account-Id': accountId,
        Authorization: `Bearer ${token}`,
      },
    }
  );
  const data = await response.json();
  return data.results;
}

async function getSlackUsers(token) {
  console.log('getSlackUsers');
  const response = await fetch('https://slack.com/api/users.list', {
    method: 'get',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const data = await response.json();
  return data.members.filter((user) => !user.deleted && !user.is_bot);
}

async function dteligence(timeSheetDateToCheck) {
  console.log('dteligence');
  const harvestUsers = await getHarvestUsers(
    process.env.DTELIGENCE_HARVEST_ACCOUNT_ID,
    process.env.HARVEST_TOKEN,
    process.env.DTELIGENCE_EMAILS_WHITELIST
  );
  const harvestTeamTimeReport = await getHarvestTeamTimeReport(
    process.env.DTELIGENCE_HARVEST_ACCOUNT_ID,
    process.env.HARVEST_TOKEN,
    timeSheetDateToCheck,
    timeSheetDateToCheck
  );
  
  const excludedRoles = ['DevOps','QA Engineer','ML Engineer','Backend Developer','Frontend Developer'];
  const usersToNotify = [];
  harvestUsers.forEach((user) => {
    // Filter reports by user_id
    const timeReports = harvestTeamTimeReport.filter((t) => t.user_id === user.id);
    // Sum up the total_hours from each filtered report
    const totalHours = timeReports.reduce((sum, report) => sum + report.total_hours, 0);
    // Filter developers with totalHours equal to 0
    // console.log(user.first_name, ' ', user.roles);
    if (totalHours === 0 || totalHours % 1 == 0) {
      const userRoles = user.roles;
      const hasExcludedRole = userRoles.some(role => excludedRoles.includes(role));

      //if (hasExcludedRole) 
     // {
        
        const statusTimer = getStatustimer(
          process.env.DTELIGENCE_HARVEST_ACCOUNT_ID,
          process.env.HARVEST_TOKEN,
          user.id
        );

        console.log(statusTimer)
      
        if ( !statusTimer.time_entries || !statusTimer.time_entries.length )
        {
          console.log(user.first_name, ' пустой, тайемер не запущен');
        }
        else
        {
          console.log(user.first_name, ' есть, тайемер запущен');
        }
        
        usersToNotify.push({
          ...user,
          totalHours,
        }); 
      //}
    }
    // console.log('usersToNotify', usersToNotify);
  });
  return usersToNotify;
}

async function slackNotify(usersToNotify, timeSheetDateToCheck) {
  console.log('slackNotify');
  if (usersToNotify && usersToNotify.length) {
    const slackUsers = await getSlackUsers(process.env.SLACK_TOKEN);
    
    usersToNotify.forEach((user) => {
      const fullName = `${user.first_name} ${user.last_name}`;
      const slackUser = slackUsers.find(
        (slackUser) =>
          [
            slackUser.profile.real_name_normalized.toLowerCase(),
            slackUser.profile.display_name_normalized.toLowerCase(),
          ].includes(fullName.toLowerCase()) ||
          (slackUser.profile.email || '').toLowerCase() === user.email.toLowerCase()
      );
      user.slackUser = slackUser
        ? `<@${slackUser.id}>`
        : `${fullName}`;
    });
     // console.log(
     //   'usersToNotify',
     //   usersToNotify.map((user) => user.slackUser)
     // );
    const slackBlocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: "*Привет, я бот, который напоминает, что вы забыли включить трекер времени в Harvest. Не забывайте выбирать проект (модуль) и тип задачи правильно, чтобы затраченное время списывалось на проекты корректно.*",
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Я заметил, что следующие сотрудники еще не затрекали часов за ${moment(
            timeSheetDateToCheck
          ).format('D MMMM')}:`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• ${usersToNotify.map((user) => user.slackUser).join('\n• ')}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: 'Пожалуйста, откройте задачу в Jira и включите таймер.',
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: ':clock5: Report Time',
              emoji: true,
            },
            value: 'report_time',
            url: 'https://harvestapp.com/time',
            action_id: 'button-action',
            style: 'primary',
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: ':sos: Инструкция',
              emoji: true,
            },
            value: 'instructions',
            url: 'https://www.notion.so/stellarlabs/Time-tracking-e1eca92b7fc54752b0fa6af1c2eac5aa',
            action_id: 'button-action-2',
            style: 'primary',
          },
        ],
      },
    ];
    //  const response = await fetch(
    //    `https://slack.com/api/chat.postMessage?channel=${
    //      process.env.SLACK_CHANNEL
    //    }&blocks=${encodeURIComponent(JSON.stringify(slackBlocks))}&pretty=1`,
    //    {
    //      method: 'post',
    //      headers: {
    //        'Content-Type': 'application/x-www-form-urlencoded',
    //        Accept: 'application/json',
    //        charset: 'utf-8',
    //        Authorization: `Bearer ${process.env.SLACK_TOKEN}`,
    //      },
    //    }
    //  );
    // const data = await response.json();
    // console.log('slackResponse', data);
  } else return;
}

async function app() {
  let timeSheetDateToCheck;
  const weekday = moment().format('dddd');
  if (!['суббота', 'воскресенье'].includes(weekday)) {
    if (['понедельник', 'вторник', 'среда', 'четверг', 'пятница'].includes(weekday)) {
      timeSheetDateToCheck = moment().subtract(0, 'days').format('YYYY-MM-DD');
    } else {
      timeSheetDateToCheck = moment().subtract(2, 'days').format('YYYY-MM-DD');
    }
    const usersToNotify = [...(await dteligence(timeSheetDateToCheck))];
    await slackNotify(usersToNotify, timeSheetDateToCheck);
    process.exit();
  }
}

app();
