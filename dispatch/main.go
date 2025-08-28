package main

import (
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"os"
	"strconv"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const (
	Service = "dispatch"
)

var (
	amqpUri          string
	rabbitChan       *amqp.Channel
	rabbitCloseError chan *amqp.Error
	rabbitReady      chan bool
	errorPercent     int
)

func connectToRabbitMQ(uri string) *amqp.Connection {
	for {
		conn, err := amqp.Dial(uri)
		if err == nil {
			return conn
		}

		log.Println(err)
		log.Printf("Reconnecting to %s\n", uri)
		time.Sleep(1 * time.Second)
	}
}

func rabbitConnector(uri string) {
	var rabbitErr *amqp.Error

	for {
		rabbitErr = <-rabbitCloseError
		if rabbitErr == nil {
			return
		}

		log.Printf("Connecting to %s\n", amqpUri)
		rabbitConn := connectToRabbitMQ(uri)
		rabbitConn.NotifyClose(rabbitCloseError)

		var err error

		rabbitChan, err = rabbitConn.Channel()
		failOnError(err, "Failed to create channel")

		err = rabbitChan.ExchangeDeclare("robot-shop", "direct", true, false, false, false, nil)
		failOnError(err, "Failed to create exchange")

		queue, err := rabbitChan.QueueDeclare("orders", true, false, false, false, nil)
		failOnError(err, "Failed to create queue")

		err = rabbitChan.QueueBind(queue.Name, "orders", "robot-shop", false, nil)
		failOnError(err, "Failed to bind queue")

		rabbitReady <- true
	}
}

func failOnError(err error, msg string) {
	if err != nil {
		log.Fatalf("%s : %s", msg, err)
	}
}

func getOrderId(order []byte) string {
	id := "unknown"
	var f interface{}
	err := json.Unmarshal(order, &f)
	if err == nil {
		m := f.(map[string]interface{})
		id = m["orderid"].(string)
	}
	return id
}

func processOrder(orderID string) {
	log.Printf("Processing order ID: %s", orderID)
	time.Sleep(time.Duration(42+rand.Int63n(42)) * time.Millisecond)

	if rand.Intn(100) < errorPercent {
		log.Printf("Simulated dispatch failure for order %s", orderID)
	} else {
		log.Printf("Order %s dispatched successfully", orderID)
	}

	processSale(orderID)
}

func processSale(orderID string) {
	log.Printf("Order %s sent for further processing", orderID)
	time.Sleep(time.Duration(42+rand.Int63n(42)) * time.Millisecond)
}

func main() {
	rand.Seed(time.Now().Unix())

	// Init AMQP URI
	amqpHost, ok := os.LookupEnv("AMQP_HOST")
	if !ok {
		amqpHost = "rabbitmq"
	}
	amqpUri = fmt.Sprintf("amqp://guest:guest@%s:5672/", amqpHost)

	// Error simulation percent
	errorPercent = 0
	epct, ok := os.LookupEnv("DISPATCH_ERROR_PERCENT")
	if ok {
		if epcti, err := strconv.Atoi(epct); err == nil {
			if epcti > 100 {
				epcti = 100
			}
			if epcti < 0 {
				epcti = 0
			}
			errorPercent = epcti
		}
	}
	log.Printf("Error Percent is %d\n", errorPercent)

	rabbitCloseError = make(chan *amqp.Error)
	rabbitReady = make(chan bool)

	go rabbitConnector(amqpUri)
	rabbitCloseError <- amqp.ErrClosed

	go func() {
		for {
			ready := <-rabbitReady
			log.Printf("Rabbit MQ ready: %v\n", ready)

			msgs, err := rabbitChan.Consume("orders", "", true, false, false, false, nil)
			failOnError(err, "Failed to consume")

			for d := range msgs {
				log.Printf("Order body: %s\n", d.Body)
				log.Printf("Headers: %v\n", d.Headers)
				id := getOrderId(d.Body)
				go processOrder(id)
			}
		}
	}()

	log.Println("Waiting for messages...")
	select {}
}
